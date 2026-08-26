import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ApiKeyRegistry } from "../../src/auth/api-keys.js";
import { RateLimiter } from "../../src/auth/rate-limiter.js";
import { CompanyCache } from "../../src/cache/company.cache.js";
import { BialaListaProvider } from "../../src/providers/biala-lista.provider.js";
import { GusProvider, ProviderRegistry, ViesProvider } from "../../src/providers/index.js";
import { CompanyService } from "../../src/services/company.service.js";
import { stubFetch, type FetchStub } from "../helpers/fetch-mock.js";
import {
  GUS_LOGIN_RESPONSE,
  GUS_LOGOUT_RESPONSE,
  GUS_SEARCH_FOUND,
  NIP_ORLEN,
  REGON9_ORLEN,
  WL_ACCOUNT,
  WL_ACTIVE,
  WL_EXEMPT,
} from "../helpers/fixtures.js";

const GUS_URL = "https://gus.test/svc";
const WL_URL = "https://wl.test";

const soap = (body: string) => ({ status: 200, body });
const json = (payload: unknown, status = 200) => ({ status, body: JSON.stringify(payload) });

/** The real adapters, pointed at stubbed hosts — only `fetch` is faked. */
function buildApp() {
  const service = new CompanyService({
    registry: new ProviderRegistry({
      gus: new GusProvider({ baseUrl: GUS_URL, userKey: "test-key" }),
      vies: new ViesProvider({ baseUrl: "https://vies.test" }),
    }),
    cache: new CompanyCache({ ttlMs: 60_000, maxEntries: 10 }),
    vatEnricher: new BialaListaProvider({ baseUrl: WL_URL, today: () => "2026-08-26" }),
  });

  return createApp({
    quiet: true,
    service,
    auth: {
      registry: new ApiKeyRegistry(),
      limiter: new RateLimiter({ sweepIntervalMs: 0 }),
      limits: { anonymousDaily: 100, starterMonthly: 100, proMonthly: 100 },
    },
  });
}

let stub: FetchStub | undefined;
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

describe("Polish lookup: GUS + Biała Lista, end to end", () => {
  it("returns registry data enriched with VAT status and bank accounts", async () => {
    stub = stubFetch([
      soap(GUS_LOGIN_RESPONSE),
      soap(GUS_SEARCH_FOUND),
      soap(GUS_LOGOUT_RESPONSE),
      json(WL_ACTIVE),
    ]);

    const res = await buildApp().request(`/api/v1/company/PL/${NIP_ORLEN}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      country: "PL",
      company_code: REGON9_ORLEN,
      vat_code: `PL${NIP_ORLEN}`,
      name: "ORLEN SPÓŁKA AKCYJNA",
      address: {
        street: "ul. Chemików 7",
        city: "Płock",
        postal_code: "09-411",
        country: "PL",
        full_address: "ul. Chemików 7, 09-411 Płock, Poland",
      },
      is_vat_valid: true,
      source: "GUS_BIR",
      vat_status: "Czynny",
      bank_accounts: [WL_ACCOUNT],
      enriched_by: ["BIALA_LISTA"],
    });
  });

  it("queries the registers in order: GUS session, search, logout, then the white list", async () => {
    stub = stubFetch([
      soap(GUS_LOGIN_RESPONSE),
      soap(GUS_SEARCH_FOUND),
      soap(GUS_LOGOUT_RESPONSE),
      json(WL_ACTIVE),
    ]);

    await buildApp().request(`/api/v1/company/PL/${NIP_ORLEN}`);

    expect(stub.calls).toHaveLength(4);
    expect(stub.calls.slice(0, 3).map((call) => call.url)).toEqual([GUS_URL, GUS_URL, GUS_URL]);
    expect(stub.calls[3]?.url).toBe(`${WL_URL}/api/search/nip/${NIP_ORLEN}?date=2026-08-26`);
    expect(stub.calls[3]?.method).toBe("GET");
  });

  it("reports an exempt company as not VAT-valid", async () => {
    stub = stubFetch([
      soap(GUS_LOGIN_RESPONSE),
      soap(GUS_SEARCH_FOUND),
      soap(GUS_LOGOUT_RESPONSE),
      json(WL_EXEMPT),
    ]);

    const res = await buildApp().request(`/api/v1/company/PL/${NIP_ORLEN}`);
    await expect(res.json()).resolves.toMatchObject({
      is_vat_valid: false,
      vat_status: "Zwolniony",
      enriched_by: ["BIALA_LISTA"],
    });
  });

  it("still returns the company when the white list is down", async () => {
    stub = stubFetch([
      soap(GUS_LOGIN_RESPONSE),
      soap(GUS_SEARCH_FOUND),
      soap(GUS_LOGOUT_RESPONSE),
      { status: 500, body: "gateway error" },
      { status: 500, body: "gateway error" },
      { status: 500, body: "gateway error" },
    ]);

    const res = await buildApp().request(`/api/v1/company/PL/${NIP_ORLEN}`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      success: true,
      name: "ORLEN SPÓŁKA AKCYJNA",
      is_vat_valid: false,
      source: "GUS_BIR",
    });
    expect(body.vat_status).toBeUndefined();
    expect(body.enriched_by).toBeUndefined();
  });

  it("does not consult the white list for a Lithuanian lookup", async () => {
    stub = stubFetch([
      json({ countryCode: "LT", vatNumber: "100001919817", valid: true, name: "UAB X", address: "A 1\nLT-01103 VILNIUS" }),
    ]);

    const res = await buildApp().request("/api/v1/company/LT/100001919817");

    expect(res.status).toBe(200);
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.url).toContain("vies.test");
  });
});
