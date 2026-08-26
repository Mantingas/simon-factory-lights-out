import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { CompanyCache } from "../../src/cache/company.cache.js";
import { ApiError } from "../../src/errors.js";
import { ProviderRegistry } from "../../src/providers/index.js";
import { CompanyService } from "../../src/services/company.service.js";
import { companyFor, stubProvider, type StubProvider } from "../helpers/stub-provider.js";
import { NIP_ORLEN, REGON9_ORLEN } from "../helpers/fixtures.js";

function buildApp(overrides: { gus?: StubProvider; vies?: StubProvider } = {}) {
  const gus =
    overrides.gus ??
    stubProvider("GUS_BIR", (input) =>
      companyFor(input, "GUS_BIR", {
        company_code: REGON9_ORLEN,
        vat_code: `PL${input.code}`,
        name: "ORLEN SPÓŁKA AKCYJNA",
        address: {
          street: "ul. Chemików 7",
          city: "Płock",
          postal_code: "09-411",
          country: "PL",
          full_address: "ul. Chemików 7, 09-411 Płock, Poland",
        },
        is_vat_valid: false,
      }),
    );
  const vies =
    overrides.vies ??
    stubProvider("VIES", (input) =>
      companyFor(input, "VIES", {
        name: "UAB PAVYZDYS",
        address: {
          street: "GEDIMINO PR. 1",
          city: "VILNIUS",
          postal_code: "01103",
          country: input.country,
          full_address: "GEDIMINO PR. 1, LT-01103 VILNIUS",
        },
      }),
    );

  const service = new CompanyService({
    registry: new ProviderRegistry({ gus, vies }),
    cache: new CompanyCache({ ttlMs: 60_000, maxEntries: 50 }),
  });

  return { app: createApp({ service, quiet: true }), gus, vies };
}

describe("GET /health", () => {
  it("returns ok with an ISO-8601 timestamp", async () => {
    const { app } = buildApp();
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

describe("GET /api/v1/company", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it("returns a Lithuanian company from VIES in the normalized shape", async () => {
    const res = await ctx.app.request("/api/v1/company?country=LT&code=100001919817");

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      country: "LT",
      company_code: "100001919817",
      vat_code: "LT100001919817",
      name: "UAB PAVYZDYS",
      address: {
        street: "GEDIMINO PR. 1",
        city: "VILNIUS",
        postal_code: "01103",
        country: "LT",
        full_address: "GEDIMINO PR. 1, LT-01103 VILNIUS",
      },
      is_vat_valid: true,
      source: "VIES",
    });
  });

  it("returns a Polish company from GUS", async () => {
    const res = await ctx.app.request(`/api/v1/company?country=PL&code=${NIP_ORLEN}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      country: "PL",
      company_code: REGON9_ORLEN,
      vat_code: `PL${NIP_ORLEN}`,
      source: "GUS_BIR",
    });
    expect(ctx.gus.calls).toHaveLength(1);
    expect(ctx.vies.calls).toHaveLength(0);
  });

  it("serves the path form identically to the query form", async () => {
    const viaQuery = await ctx.app.request("/api/v1/company?country=LT&code=100001919817");
    const viaPath = await ctx.app.request("/api/v1/company/LT/100001919817");

    const queryBody = (await viaQuery.json()) as Record<string, unknown>;
    const pathBody = (await viaPath.json()) as Record<string, unknown>;
    expect(viaPath.status).toBe(200);
    // The second request is a cache hit, so only `source` differs.
    expect({ ...pathBody, source: queryBody.source }).toEqual(queryBody);
  });

  it("lower-cases country codes and ignores separators in the code", async () => {
    const res = await ctx.app.request("/api/v1/company?country=lt&code=100-001.919%20817");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ country: "LT", company_code: "100001919817" });
  });

  it("routes a VAT-prefixed Polish code to VIES", async () => {
    const res = await ctx.app.request(`/api/v1/company?country=PL&code=PL${NIP_ORLEN}`);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ source: "VIES", is_vat_valid: true });
    expect(ctx.vies.calls).toHaveLength(1);
    expect(ctx.gus.calls).toHaveLength(0);
  });

  it("marks a repeat lookup as served from cache", async () => {
    await ctx.app.request("/api/v1/company?country=LT&code=100001919817");
    const res = await ctx.app.request("/api/v1/company?country=LT&code=100001919817");

    await expect(res.json()).resolves.toMatchObject({ source: "CACHE" });
    expect(ctx.vies.calls).toHaveLength(1);
  });

  it("bypasses the cache with refresh=true", async () => {
    await ctx.app.request("/api/v1/company?country=LT&code=100001919817");
    const res = await ctx.app.request("/api/v1/company?country=LT&code=100001919817&refresh=true");

    await expect(res.json()).resolves.toMatchObject({ source: "VIES" });
    expect(ctx.vies.calls).toHaveLength(2);
  });

  it("echoes the caller's x-request-id through the access log middleware", async () => {
    // `quiet` is off here so the request-logger middleware is actually mounted.
    const logged = createApp({ service: new CompanyService() });
    const res = await logged.request("/health", { headers: { "x-request-id": "req-42" } });
    expect(res.headers.get("x-request-id")).toBe("req-42");
  });

  it("generates an x-request-id when the caller does not supply one", async () => {
    const logged = createApp({ service: new CompanyService() });
    const res = await logged.request("/health");
    expect(res.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/v1/company error handling", () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(() => {
    ctx = buildApp();
  });

  it.each([
    ["a missing country", "/api/v1/company?code=100001919817"],
    ["a missing code", "/api/v1/company?country=LT"],
    ["a 3-letter country", "/api/v1/company?country=LTU&code=100001919817"],
    ["an illegal code", "/api/v1/company?country=LT&code=%24%24%24"],
  ])("returns 400 VALIDATION_ERROR for %s", async (_label, path) => {
    const res = await ctx.app.request(path);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("lists the offending fields in the error details", async () => {
    const res = await ctx.app.request("/api/v1/company?country=LTU&code=1");
    const body = (await res.json()) as { error: { details: Array<{ field: string }> } };
    expect(body.error.details.map((d) => d.field).sort()).toEqual(["code", "country"]);
  });

  it("returns 422 UNSUPPORTED_COUNTRY outside the EU", async () => {
    const res = await ctx.app.request("/api/v1/company?country=US&code=123456789");
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "UNSUPPORTED_COUNTRY", details: { country: "US" } },
    });
  });

  it("returns 404 when the provider finds nothing", async () => {
    const missing = buildApp({ vies: stubProvider("VIES", ApiError.notFound("not registered")) });
    const res = await missing.app.request("/api/v1/company?country=LT&code=100001919817");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "NOT_FOUND" } });
  });

  it("returns 502 when the upstream fails", async () => {
    const down = buildApp({ vies: stubProvider("VIES", ApiError.upstream("VIES is unreachable.")) });
    const res = await down.app.request("/api/v1/company?country=LT&code=100001919817");
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "UPSTREAM_ERROR" } });
  });

  it("returns 504 when the upstream times out", async () => {
    const slow = buildApp({ vies: stubProvider("VIES", ApiError.timeout("VIES timed out.")) });
    const res = await slow.app.request("/api/v1/company?country=LT&code=100001919817");
    expect(res.status).toBe(504);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "UPSTREAM_TIMEOUT" } });
  });

  it("returns 500 without leaking internals when a provider throws unexpectedly", async () => {
    const broken = buildApp({ vies: stubProvider("VIES", new TypeError("boom")) });
    const res = await broken.app.request("/api/v1/company?country=LT&code=100001919817");
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected internal error." },
    });
  });

  it("returns a JSON 404 envelope for an unknown route", async () => {
    const res = await ctx.app.request("/api/v1/nope");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
  });
});
