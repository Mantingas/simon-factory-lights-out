import { beforeEach, describe, expect, it } from "vitest";
import { CompanyCache } from "../../src/cache/company.cache.js";
import { ApiError } from "../../src/errors.js";
import { ProviderRegistry } from "../../src/providers/index.js";
import { CompanyService } from "../../src/services/company.service.js";
import { companyFor, stubProvider, type StubProvider } from "../helpers/stub-provider.js";
import { NIP_ORLEN, lookupInput } from "../helpers/fixtures.js";

function build(options: { gus?: StubProvider; vies?: StubProvider } = {}) {
  const gus = options.gus ?? stubProvider("GUS_BIR", (input) => companyFor(input, "GUS_BIR"));
  const vies = options.vies ?? stubProvider("VIES", (input) => companyFor(input, "VIES"));
  const cache = new CompanyCache({ ttlMs: 60_000, maxEntries: 10 });
  const service = new CompanyService({
    registry: new ProviderRegistry({ gus, vies }),
    cache,
  });
  return { service, cache, gus, vies };
}

describe("CompanyService.lookup", () => {
  let ctx: ReturnType<typeof build>;

  beforeEach(() => {
    ctx = build();
  });

  it("calls the provider on a cache miss and reports the provider as the source", async () => {
    const result = await ctx.service.lookup(lookupInput());
    expect(result.source).toBe("VIES");
    expect(ctx.vies.calls).toHaveLength(1);
  });

  it("serves the second identical lookup from cache without hitting the provider", async () => {
    await ctx.service.lookup(lookupInput());
    const cached = await ctx.service.lookup(lookupInput());

    expect(cached.source).toBe("CACHE");
    expect(cached.name).toBe("Company 100001919817");
    expect(ctx.vies.calls).toHaveLength(1);
  });

  it("keys the cache by country and code", async () => {
    await ctx.service.lookup(lookupInput({ country: "LT" }));
    await ctx.service.lookup(lookupInput({ country: "LV" }));
    expect(ctx.vies.calls).toHaveLength(2);
  });

  it("bypasses the cache when refresh is requested but still repopulates it", async () => {
    await ctx.service.lookup(lookupInput());
    const fresh = await ctx.service.lookup(lookupInput(), { refresh: true });
    expect(fresh.source).toBe("VIES");
    expect(ctx.vies.calls).toHaveLength(2);

    const cached = await ctx.service.lookup(lookupInput());
    expect(cached.source).toBe("CACHE");
  });

  it("does not cache a NOT_FOUND result", async () => {
    const failing = build({
      vies: stubProvider("VIES", ApiError.notFound("nope")),
    });
    await expect(failing.service.lookup(lookupInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(failing.service.lookup(lookupInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(failing.vies.calls).toHaveLength(2);
  });

  it("falls back to the next provider when the first one is down", async () => {
    const plInput = lookupInput({ country: "PL", code: NIP_ORLEN, rawCode: NIP_ORLEN });
    const ctxDown = build({
      gus: stubProvider("GUS_BIR", ApiError.upstream("GUS BIR is unreachable.")),
    });

    const result = await ctxDown.service.lookup(plInput);
    expect(result.source).toBe("VIES");
    expect(ctxDown.gus.calls).toHaveLength(1);
    expect(ctxDown.vies.calls).toHaveLength(1);
  });

  it("does not fall back when the first provider says NOT_FOUND", async () => {
    const plInput = lookupInput({ country: "PL", code: NIP_ORLEN, rawCode: NIP_ORLEN });
    const ctxMissing = build({
      gus: stubProvider("GUS_BIR", ApiError.notFound("no such entity")),
    });

    await expect(ctxMissing.service.lookup(plInput)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ctxMissing.vies.calls).toHaveLength(0);
  });

  it("surfaces the last upstream error when every provider fails", async () => {
    const plInput = lookupInput({ country: "PL", code: NIP_ORLEN, rawCode: NIP_ORLEN });
    const ctxAllDown = build({
      gus: stubProvider("GUS_BIR", ApiError.upstream("GUS down")),
      vies: stubProvider("VIES", ApiError.timeout("VIES timed out")),
    });

    await expect(ctxAllDown.service.lookup(plInput)).rejects.toMatchObject({
      code: "UPSTREAM_TIMEOUT",
    });
  });

  it("propagates an unsupported country from the registry", async () => {
    await expect(ctx.service.lookup(lookupInput({ country: "US" }))).rejects.toMatchObject({
      code: "UNSUPPORTED_COUNTRY",
      status: 422,
    });
  });

  it("exposes cache statistics", async () => {
    await ctx.service.lookup(lookupInput());
    expect(ctx.service.cacheStats()).toMatchObject({ size: 1, max: 10, ttlMs: 60_000 });
  });
});
