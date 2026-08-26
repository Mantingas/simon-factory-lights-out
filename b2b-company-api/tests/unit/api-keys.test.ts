import { describe, expect, it } from "vitest";
import { ApiKeyRegistry, parseApiKeys } from "../../src/auth/api-keys.js";
import { isTier, tierPolicy, TIERS } from "../../src/auth/tiers.js";

const LIMITS = { anonymousDaily: 20, starterMonthly: 1000, proMonthly: 50_000 };

describe("parseApiKeys — pair form", () => {
  it("parses comma-separated key:tier pairs", () => {
    expect(parseApiKeys("k1:starter,k2:pro,k3:unlimited")).toEqual([
      { key: "k1", tier: "starter" },
      { key: "k2", tier: "pro" },
      { key: "k3", tier: "unlimited" },
    ]);
  });

  it("trims whitespace around entries", () => {
    expect(parseApiKeys(" k1 : starter , k2 : pro ")).toEqual([
      { key: "k1", tier: "starter" },
      { key: "k2", tier: "pro" },
    ]);
  });

  it("keeps colons inside the key itself", () => {
    expect(parseApiKeys("proj:live:abc123:pro")).toEqual([
      { key: "proj:live:abc123", tier: "pro" },
    ]);
  });

  it("skips entries with an unknown tier instead of failing", () => {
    expect(parseApiKeys("k1:starter,k2:platinum,k3:pro")).toEqual([
      { key: "k1", tier: "starter" },
      { key: "k3", tier: "pro" },
    ]);
  });

  it("skips malformed entries", () => {
    expect(parseApiKeys("no-tier,,:starter,k1:pro")).toEqual([{ key: "k1", tier: "pro" }]);
  });

  it("returns nothing for empty or missing input", () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys("")).toEqual([]);
    expect(parseApiKeys("   ")).toEqual([]);
  });
});

describe("parseApiKeys — JSON form", () => {
  it("parses a JSON array with labels", () => {
    expect(parseApiKeys('[{"key":"k1","tier":"pro","label":"Acme"}]')).toEqual([
      { key: "k1", tier: "pro", label: "Acme" },
    ]);
  });

  it("skips entries missing a key or carrying an unknown tier", () => {
    expect(
      parseApiKeys('[{"tier":"pro"},{"key":"k2","tier":"nope"},{"key":"k3","tier":"starter"}]'),
    ).toEqual([{ key: "k3", tier: "starter" }]);
  });

  it("falls back to no keys on malformed JSON rather than crashing boot", () => {
    expect(parseApiKeys("[{oops}]")).toEqual([]);
    expect(parseApiKeys('["not-an-object"]')).toEqual([]);
  });
});

describe("ApiKeyRegistry", () => {
  it("resolves an issued key to its tier", () => {
    const registry = ApiKeyRegistry.fromEnv("k1:starter,k2:unlimited");
    expect(registry.size).toBe(2);
    expect(registry.resolve("k1")?.tier).toBe("starter");
    expect(registry.resolve("k2")?.tier).toBe("unlimited");
  });

  it("returns undefined for a key that was never issued", () => {
    expect(new ApiKeyRegistry().resolve("nope")).toBeUndefined();
  });
});

describe("tiers", () => {
  it("recognises exactly the four tiers", () => {
    expect([...TIERS]).toEqual(["anonymous", "starter", "pro", "unlimited"]);
    expect(isTier("pro")).toBe(true);
    expect(isTier("platinum")).toBe(false);
  });

  it("meters anonymous traffic daily and paid plans monthly", () => {
    expect(tierPolicy("anonymous", LIMITS)).toEqual({
      tier: "anonymous",
      limit: 20,
      window: "daily",
    });
    expect(tierPolicy("starter", LIMITS)).toEqual({
      tier: "starter",
      limit: 1000,
      window: "monthly",
    });
    expect(tierPolicy("pro", LIMITS)).toEqual({ tier: "pro", limit: 50_000, window: "monthly" });
  });

  it("gives the unlimited tier no ceiling", () => {
    expect(tierPolicy("unlimited", LIMITS).limit).toBeNull();
  });
});
