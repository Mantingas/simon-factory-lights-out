# b2b-company-api

A modular TypeScript HTTP service for **European & Baltic B2B company lookup**.

Given a country and a company/VAT code it returns one normalized record,
regardless of which national register answered. Two provider adapters are
wired in today:

| Provider | Countries | Upstream |
| --- | --- | --- |
| `GUS_BIR` | `PL` | Polish GUS REGON register, BIR1.1 SOAP API |
| `VIES` | `LT`, `LV`, `EE` + all EU member states | EU VIES VAT validation REST API |

Built on **Hono** (`@hono/node-server`), validated with **Zod**, tested with
**Vitest**, and fronted by a 24-hour in-memory **LRU cache**.

---

## Quick start

```bash
npm install
cp .env.example .env      # optional — every value has a working default
npm run dev               # http://localhost:3000
```

```bash
npm run build && npm start   # production
```

## Endpoints

### `GET /health`

```json
{ "status": "ok", "timestamp": "2026-08-26T20:54:00.000Z" }
```

### `GET /api/v1/company`

Query form and path form are equivalent:

```
GET /api/v1/company?country={COUNTRY}&code={CODE}
GET /api/v1/company/{COUNTRY}/{CODE}
```

| Parameter | Required | Rules |
| --- | --- | --- |
| `country` | yes | 2-letter ISO 3166-1 alpha-2 code (`LT`, `LV`, `EE`, `PL`, `DE`, …). Case-insensitive. |
| `code` | yes | Registration or VAT code, 3–20 alphanumerics. Spaces, dots, dashes and slashes are ignored; a leading VAT country prefix is detected and stripped. |
| `refresh` | no | `true` / `1` bypasses the cache read for this request. |

```bash
curl 'localhost:3000/api/v1/company?country=LT&code=100001919817'
curl 'localhost:3000/api/v1/company/PL/7740001454'
curl 'localhost:3000/api/v1/company?country=PL&code=774-000-14-54'
```

### Response

Every provider maps onto this exact shape:

```ts
interface CompanyResponse {
  success: boolean;
  country: string;
  company_code: string;
  vat_code?: string;
  name: string;
  address: {
    street?: string;
    city?: string;
    postal_code?: string;
    country: string;
    full_address?: string;
  };
  is_vat_valid: boolean;
  source: "VIES" | "GUS_BIR" | "CACHE";
}
```

```json
{
  "success": true,
  "country": "PL",
  "company_code": "610188201",
  "vat_code": "PL7740001454",
  "name": "ORLEN SPÓŁKA AKCYJNA",
  "address": {
    "street": "ul. Chemików 7",
    "city": "Płock",
    "postal_code": "09-411",
    "country": "PL",
    "full_address": "ul. Chemików 7, 09-411 Płock, Poland"
  },
  "is_vat_valid": false,
  "source": "GUS_BIR"
}
```

> `is_vat_valid` is `true` only when a **VAT** register confirmed the number.
> GUS is the REGON *company* register and says nothing about VAT status, so a
> `GUS_BIR` result reports `false`. To confirm Polish VAT, ask with the
> VAT-prefixed code (`code=PL7740001454`) and the request is routed to VIES.

### Errors

All failures share one envelope and never leak upstream internals:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "details": {} } }
```

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad `country`/`code`, or the member state rejected the VAT format. `details` lists the offending fields. |
| 404 | `NOT_FOUND` | No such company / VAT number, or no such route. |
| 422 | `UNSUPPORTED_COUNTRY` | No adapter covers that country. |
| 502 | `UPSTREAM_ERROR` | The register failed or returned something unparseable. |
| 504 | `UPSTREAM_TIMEOUT` | The register did not answer within `UPSTREAM_TIMEOUT_MS`. |
| 500 | `INTERNAL_ERROR` | Unexpected bug — details are logged, not returned. |

## Routing logic

`src/providers/index.ts` picks an ordered chain of adapters. Later entries are
fallbacks, tried **only** when the previous one fails upstream — a `NOT_FOUND`
is a real answer and stops the chain.

1. A **VAT-prefixed** code (`LT100001919817`, `PL7740001454`) is a VAT question → **VIES**.
2. **`PL`** → **GUS**. A Polish NIP doubles as the VAT number, so VIES is kept as a fallback;
   a REGON has no VIES equivalent, so GUS is the only option.
3. Any other **EU** member state → **VIES**. `GR` is translated to the `EL` VAT prefix and `GB` to `XI`.
4. Anything else → `422 UNSUPPORTED_COUNTRY`.

## Caching

An `lru-cache` keyed by `COUNTRY:CODE`, 24h TTL, 5000 entries by default. Hits
are returned with `source: "CACHE"` and a defensive copy, so callers cannot
mutate a cached record. **Only successful lookups are cached** — a company that
is not registered today may be tomorrow, and caching that miss for a day would
hide it.

## Project layout

```
src/
  app.ts                      Hono app factory (middleware + route mounting)
  index.ts                    @hono/node-server bootstrap + graceful shutdown
  config.ts                   Zod-validated environment configuration
  schemas.ts                  Request validation + normalization into CompanyLookupInput
  types.ts                    CompanyResponse and the CompanyProvider contract
  errors.ts                   ApiError -> HTTP status/code mapping
  cache/company.cache.ts      24h LRU
  middleware/                 error handler, structured access log
  providers/
    index.ts                  ProviderRegistry — the routing rules above
    gus.provider.ts           Polish GUS BIR1.1 (SOAP 1.2 + WS-Addressing)
    vies.provider.ts          EU VIES (REST/JSON)
  routes/                     /health, /api/v1/company
  services/company.service.ts Cache + provider-chain orchestration
  utils/                      http (timeout/retry), xml, VAT/NIP/REGON helpers, logger
tests/
  unit/                       Adapters, cache, routing, validation, transport
  integration/                Full app via app.request() and a real node-server
  helpers/                    fetch stub, provider stubs, SOAP/JSON fixtures
```

### Adding a provider

Implement `CompanyProvider` from `src/types.ts` (`name`, `supports`, `lookup`),
map the upstream payload onto `CompanyResponse`, and add it to the chain in
`ProviderRegistry.resolve`. Nothing else needs to change.

## GUS BIR1.1 notes

The SOAP endpoint is WCF, so requests are **SOAP 1.2** with WS-Addressing
headers and `Content-Type: application/soap+xml;charset=UTF-8`.

- `Zaloguj` / `Wyloguj` use the `http://CIS/BIR/2014/07` contract; `DaneSzukajPodmioty`
  uses `http://CIS/BIR/PublDane/2021/11`.
- The session id comes back in the body and is sent as the `sid` **HTTP header** on
  subsequent calls.
- The search result is XML **escaped inside** the SOAP response, so it is parsed twice.
- Each lookup opens and closes its own session. GUS expires sessions server-side
  and a stale `sid` fails the search rather than re-authenticating, so pooling
  would trade a reliable request for an unreliable one. A failed `Wyloguj` is
  logged and swallowed — it must never mask the lookup's result.
- `code` is classified as NIP (10 digits) or REGON (9/14 digits) by checksum,
  with length as the fallback, and sent in the matching search field.

The default `GUS_USER_KEY` (`abcde12345abcde12345`) is the public **test** key and
only works against the **test** endpoint in `.env.example`. For production,
register at <https://api.stat.gov.pl> and change `GUS_BASE_URL` **and** `GUS_USER_KEY`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `CACHE_TTL_MS` | `86400000` | Cache TTL (24h) |
| `CACHE_MAX_ENTRIES` | `5000` | Cache size |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Per-attempt upstream deadline |
| `UPSTREAM_RETRIES` | `2` | Extra attempts after the first (exponential backoff, capped at 2s) |
| `VIES_BASE_URL` | EU VIES REST base | Override for testing |
| `GUS_BASE_URL` | GUS BIR1.1 **test** endpoint | Swap for production |
| `GUS_USER_KEY` | public test key | Swap for production |

## Testing

```bash
npm test                # unit + integration (no network)
npm run test:coverage
npm run typecheck
```

The suite stubs `fetch`, so it is fully offline and deterministic — including
the three-step GUS SOAP handshake and the VIES retry/timeout paths.

Contract tests against the **real** upstreams are opt-in, because they need
outbound access to `ec.europa.eu` and `stat.gov.pl` and both services rate-limit:

```bash
RUN_LIVE_TESTS=1 npm run test:integration
```

## Security & operations

- `secureHeaders()` and permissive read-only CORS (`GET`, `OPTIONS`) are on by default.
- Every response carries an `x-request-id` (echoed from the request or generated),
  and the structured JSON access log records method, path, status and duration.
- Upstream calls have a hard timeout and bounded retries, so a slow register cannot
  pin a worker.
- `SIGINT`/`SIGTERM` drain in-flight requests, with a 10s hard stop.
