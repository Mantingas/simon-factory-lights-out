import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { ApiKeyRegistry } from "../../src/auth/api-keys.js";
import { RateLimiter } from "../../src/auth/rate-limiter.js";
import { CompanyCache } from "../../src/cache/company.cache.js";
import { ProviderRegistry } from "../../src/providers/index.js";
import { CompanyService } from "../../src/services/company.service.js";
import { companyFor, stubProvider } from "../helpers/stub-provider.js";

const LIMITS = { anonymousDaily: 3, starterMonthly: 5, proMonthly: 8 };
const KEYS = "starter-key:starter,pro-key:pro,vip-key:unlimited";
const LOOKUP = "/api/v1/company?country=LT&code=100001919817";

function buildApp(options: { trustProxy?: boolean; now?: () => number } = {}) {
  const limiter = new RateLimiter({
    sweepIntervalMs: 0,
    ...(options.now ? { now: options.now } : {}),
  });
  const service = new CompanyService({
    registry: new ProviderRegistry({
      gus: stubProvider("GUS_BIR", (input) => companyFor(input, "GUS_BIR")),
      vies: stubProvider("VIES", (input) => companyFor(input, "VIES")),
    }),
    cache: new CompanyCache({ ttlMs: 60_000, maxEntries: 50 }),
    vatEnricher: null,
  });

  const app = createApp({
    quiet: true,
    service,
    auth: {
      registry: ApiKeyRegistry.fromEnv(KEYS),
      limiter,
      limits: LIMITS,
      trustProxy: options.trustProxy ?? false,
    },
  });

  return { app, limiter };
}

describe("API key authentication", () => {
  it("allows an anonymous request and reports the anonymous quota", async () => {
    const { app } = buildApp();
    const res = await app.request(LOOKUP);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("3");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("2");
    expect(Number(res.headers.get("x-ratelimit-reset"))).toBeGreaterThan(0);
  });

  it("accepts a key via the x-api-key header", async () => {
    const { app } = buildApp();
    const res = await app.request(LOOKUP, { headers: { "x-api-key": "starter-key" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("5");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("4");
  });

  it("accepts a key via the api_key query parameter", async () => {
    const { app } = buildApp();
    const res = await app.request(`${LOOKUP}&api_key=pro-key`);

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("8");
  });

  it("prefers the header when both are supplied", async () => {
    const { app } = buildApp();
    const res = await app.request(`${LOOKUP}&api_key=starter-key`, {
      headers: { "x-api-key": "pro-key" },
    });

    expect(res.headers.get("x-ratelimit-limit")).toBe("8");
  });

  it("reports an unlimited key as having no ceiling", async () => {
    const { app } = buildApp();
    const res = await app.request(LOOKUP, { headers: { "x-api-key": "vip-key" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("unlimited");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("unlimited");
  });

  it("rejects an unknown key with 401 instead of silently downgrading it", async () => {
    const { app } = buildApp();
    const res = await app.request(LOOKUP, { headers: { "x-api-key": "not-issued" } });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({
      success: false,
      error: { code: "UNAUTHORIZED" },
    });
  });

  it("never echoes the rejected key back to the caller", async () => {
    const { app } = buildApp();
    const res = await app.request(LOOKUP, { headers: { "x-api-key": "super-secret-key" } });
    expect(await res.text()).not.toContain("super-secret-key");
  });

  it("leaves /health unauthenticated and unmetered", async () => {
    const { app, limiter } = buildApp();
    for (let i = 0; i < 10; i++) {
      expect((await app.request("/health")).status).toBe(200);
    }
    expect(limiter.size).toBe(0);
  });
});

describe("rate limiting", () => {
  it("returns 429 with Retry-After once the anonymous quota is spent", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 3; i++) expect((await app.request(LOOKUP)).status).toBe(200);

    const res = await app.request(LOOKUP);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("x-ratelimit-remaining")).toBe("0");

    const body = (await res.json()) as {
      success: boolean;
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(body.error.message).toContain("x-api-key");
    expect(body.error.details).toMatchObject({ tier: "anonymous", limit: 3 });
    expect(typeof body.error.details.reset_at).toBe("string");
  });

  it("returns 429 naming the plan once a starter key is spent", async () => {
    const { app } = buildApp();
    const headers = { "x-api-key": "starter-key" };
    for (let i = 0; i < 5; i++) expect((await app.request(LOOKUP, { headers })).status).toBe(200);

    const res = await app.request(LOOKUP, { headers });
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "RATE_LIMITED", details: { tier: "starter", limit: 5 } },
    });
  });

  it("meters each key independently", async () => {
    const { app } = buildApp();
    for (let i = 0; i < 5; i++) await app.request(LOOKUP, { headers: { "x-api-key": "starter-key" } });

    expect((await app.request(LOOKUP, { headers: { "x-api-key": "starter-key" } })).status).toBe(429);
    expect((await app.request(LOOKUP, { headers: { "x-api-key": "pro-key" } })).status).toBe(200);
  });

  it("does not meter an unlimited key at all", async () => {
    const { app } = buildApp();
    const headers = { "x-api-key": "vip-key" };
    for (let i = 0; i < 30; i++) {
      expect((await app.request(LOOKUP, { headers })).status).toBe(200);
    }
  });

  it("counts a 404 lookup against the quota — the upstream call was still made", async () => {
    const { app, limiter } = buildApp();
    await app.request("/api/v1/company?country=US&code=123456789");
    expect(limiter.size).toBe(1);
  });

  it("refills the anonymous quota after 24 hours", async () => {
    let now = Date.UTC(2026, 0, 15, 12, 0, 0);
    const { app } = buildApp({ now: () => now });

    for (let i = 0; i < 3; i++) await app.request(LOOKUP);
    expect((await app.request(LOOKUP)).status).toBe(429);

    now += 24 * 60 * 60 * 1000 + 1;
    expect((await app.request(LOOKUP)).status).toBe(200);
  });
});

describe("anonymous identity and proxy trust", () => {
  it("shares one bucket across spoofed x-forwarded-for values when the proxy is untrusted", async () => {
    const { app } = buildApp({ trustProxy: false });

    for (let i = 0; i < 3; i++) {
      await app.request(LOOKUP, { headers: { "x-forwarded-for": `10.0.0.${i}` } });
    }
    const res = await app.request(LOOKUP, { headers: { "x-forwarded-for": "10.0.0.99" } });
    expect(res.status).toBe(429);
  });

  it("meters each forwarded client separately when the proxy is trusted", async () => {
    const { app } = buildApp({ trustProxy: true });

    for (let i = 0; i < 3; i++) {
      await app.request(LOOKUP, { headers: { "x-forwarded-for": "9.9.9.9" } });
    }
    expect((await app.request(LOOKUP, { headers: { "x-forwarded-for": "9.9.9.9" } })).status).toBe(429);
    expect((await app.request(LOOKUP, { headers: { "x-forwarded-for": "8.8.8.8" } })).status).toBe(200);
  });
});
