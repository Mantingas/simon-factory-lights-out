# b2b-company-api

A modular TypeScript HTTP service for **European & Baltic B2B company lookup**.

Given a country and a company/VAT code it returns one normalized record,
regardless of which national register answered. Two provider adapters are
wired in today:

| Registry | Role | Countries | Upstream |
| --- | --- | --- | --- |
| `GUS_BIR` | lookup | `PL` | Polish GUS REGON register, BIR1.1 SOAP API |
| `VIES` | lookup | `LT`, `LV`, `EE` + all EU member states | EU VIES VAT validation REST API |
| `BIALA_LISTA` | enrichment | `PL` | Ministry of Finance VAT white list (REST, no key) |

Built on **Hono** (`@hono/node-server`), validated with **Zod**, tested with
**Vitest**, fronted by a 24-hour in-memory **LRU cache**, and metered by
**API-key tiers** with per-tier rate limits.

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
| `api_key` | no | API key, as an alternative to the `x-api-key` header. See [Authentication](#authentication--rate-limiting). |

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
  vat_status?: string;        // registry wording, e.g. "Czynny" / "Zwolniony"
  bank_accounts?: string[];   // registered IBANs (Biała Lista)
  enriched_by?: string[];     // secondary registries consulted, e.g. ["BIALA_LISTA"]
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
  "is_vat_valid": true,
  "source": "GUS_BIR",
  "vat_status": "Czynny",
  "bank_accounts": ["12124012121111000012345678"],
  "enriched_by": ["BIALA_LISTA"]
}
```

> `is_vat_valid` is `true` only when a **VAT** register confirmed the number.
> GUS is the REGON *company* register and says nothing about VAT status, so
> every Polish lookup is enriched from Biała Lista (below). If that register is
> unreachable the field degrades to `false` and `vat_status` is omitted — the
> company data is still returned.

### Errors

All failures share one envelope and never leak upstream internals:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…", "details": {} } }
```

| HTTP | `error.code` | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Bad `country`/`code`, or the member state rejected the VAT format. `details` lists the offending fields. |
| 401 | `UNAUTHORIZED` | An API key was presented but is not issued. |
| 404 | `NOT_FOUND` | No such company / VAT number, or no such route. |
| 422 | `UNSUPPORTED_COUNTRY` | No adapter covers that country. |
| 429 | `RATE_LIMITED` | Tier quota exhausted. Carries a `Retry-After` header. |
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

## Authentication & rate limiting

Auth and metering guard `/api/v1/*` only — `GET /health` needs no key and
consumes no quota, so orchestrators can probe it freely.

A key may be presented as the `x-api-key` header or an `api_key` query
parameter; the header wins if both are present.

| Tier | Key required | Quota | Window |
| --- | --- | --- | --- |
| `anonymous` | no | 20 requests **per IP** | rolling 24 hours |
| `starter` | yes | 1,000 requests | calendar month (UTC) |
| `pro` | yes | 50,000 requests | calendar month (UTC) |
| `unlimited` | yes | unmetered | — |

Every response carries the current quota state:

```
x-ratelimit-limit: 1000
x-ratelimit-remaining: 997
x-ratelimit-reset: 1767225600      # epoch seconds
```

Exhausting the quota returns `429` with a `Retry-After` header:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Anonymous quota of 20 requests per 24 hours exhausted. Supply an API key via the 'x-api-key' header for a higher limit.",
    "details": {
      "tier": "anonymous",
      "limit": 20,
      "reset_at": "2026-08-27T21:00:00.000Z",
      "retry_after_seconds": 86400
    }
  }
}
```

An **unrecognised** key is a `401`, not a silent downgrade to `anonymous` — a
customer with a revoked or mistyped key should find out rather than quietly
hit the 20/day cap. Rejected keys are never echoed back, and logs record only a
masked prefix (`sk-l********`).

### Issuing keys

Set `API_KEYS` as `key:tier` pairs or a JSON array:

```bash
API_KEYS=dev-starter-key:starter,dev-pro-key:pro,dev-unlimited-key:unlimited
API_KEYS='[{"key":"sk-live-abc","tier":"pro","label":"Acme Sp. z o.o."}]'
```

Entries with an unknown tier are logged and skipped rather than failing boot —
one bad key should not take the service down. Tests and embedders can inject an
`ApiKeyRegistry` and `RateLimiter` directly via `createApp({ auth: … })`.

```bash
curl -H 'x-api-key: dev-pro-key' 'localhost:3000/api/v1/company?country=PL&code=7740001454'
curl 'localhost:3000/api/v1/company?country=LT&code=100001919817&api_key=dev-pro-key'
```

### Two operational caveats

- **Counters are in-memory and per-process.** Each instance meters its own
  traffic, so N replicas effectively multiply every quota by N. A horizontally
  scaled deployment needs a shared store (Redis) behind the `RateLimiter`
  interface — the middleware does not otherwise change.
- **`TRUST_PROXY` is off by default.** Anonymous quota is metered per IP, and an
  unconditionally trusted `x-forwarded-for` lets any caller mint a fresh identity
  per request and bypass the limit entirely. Turn it on only when a proxy you
  control sets that header.

## Polish VAT status (Biała Lista)

GUS answers *"does this company exist, and what are its details"*. It cannot
answer *"is it an active VAT payer"* — that is the Ministry of Finance's
**Biała Lista podatników VAT**, a free unauthenticated REST API:

```
GET https://wl-api.mf.gov.pl/api/search/nip/{nip}?date=YYYY-MM-DD
```

Every successful `GUS_BIR` lookup is enriched from it:

| `statusVat` | `is_vat_valid` | Meaning |
| --- | --- | --- |
| `Czynny` | `true` | Active VAT payer — may issue VAT invoices |
| `Zwolniony` | `false` | Registered but VAT-exempt |
| `Niezarejestrowany` / absent from the list | `false` | Not VAT-registered |

Registered `accountNumbers` are normalized (separators stripped, de-duplicated)
and returned as `bank_accounts` — the accounts a payment must go to for the
buyer to keep VAT deductibility.

Design notes:

- **Enrichment never fails a lookup.** Any error, timeout, non-JSON body or
  unrecognised payload returns "no answer", and the caller gets the unenriched
  company with `is_vat_valid: false`. A white-list outage degrades the response;
  it does not break it.
- **An unrecognised body is not an answer.** Only an explicit `result` with a
  `null` subject is read as "not registered". A maintenance page must not be
  able to invent a VAT status.
- **The as-of date is Warsaw local time**, not UTC — the register rejects future
  dates, and a late-evening UTC date would ask about yesterday.
- **VIES results are not enriched.** VIES has already given an authoritative VAT
  answer; a second opinion could only contradict it.

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
  auth/
    tiers.ts                  Tier definitions and per-tier quota policy
    api-keys.ts               API_KEYS parsing + issued-key registry
    rate-limiter.ts           In-memory fixed-window counters
  middleware/
    auth.ts                   API key auth + quota metering
    error-handler.ts          ApiError -> JSON envelope
    request-logger.ts         Structured access log
  providers/
    index.ts                  ProviderRegistry — the routing rules above
    gus.provider.ts           Polish GUS BIR1.1 (SOAP 1.2 + WS-Addressing)
    vies.provider.ts          EU VIES (REST/JSON)
    biala-lista.provider.ts   Polish VAT white list (enrichment)
  routes/                     /health, /api/v1/company
  services/company.service.ts Cache + provider-chain + enrichment orchestration
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

To add a *secondary* registry instead, implement `VatEnricher` (`name`,
`supports`, `enrich`) and pass it as `CompanyService`'s `vatEnricher`. An
enricher must return `undefined` rather than throw — enrichment is never allowed
to fail a lookup.

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
| `WL_BASE_URL` | `https://wl-api.mf.gov.pl` | Biała Lista base URL |
| `WL_ENABLED` | `true` | Set `false` to skip VAT enrichment entirely |
| `API_KEYS` | *(empty)* | Issued keys — `key:tier` pairs or a JSON array |
| `TRUST_PROXY` | `false` | Believe `x-forwarded-for` when metering anonymous callers |
| `ANONYMOUS_DAILY_LIMIT` | `20` | Anonymous requests per IP per 24h |
| `STARTER_MONTHLY_LIMIT` | `1000` | `starter` plan monthly quota |
| `PRO_MONTHLY_LIMIT` | `50000` | `pro` plan monthly quota |

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

- API keys are matched against an in-memory registry; rejected keys are never echoed
  back and only a masked prefix reaches the logs.
- `secureHeaders()` and permissive read-only CORS (`GET`, `OPTIONS`) are on by default.
- Every response carries an `x-request-id` (echoed from the request or generated),
  and the structured JSON access log records method, path, status and duration.
- Upstream calls have a hard timeout and bounded retries, so a slow register cannot
  pin a worker.
- `SIGINT`/`SIGTERM` drain in-flight requests, with a 10s hard stop.
