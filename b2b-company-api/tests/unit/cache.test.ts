import { beforeEach, describe, expect, it } from "vitest";
import { CompanyCache, cacheKey } from "../../src/cache/company.cache.js";
import type { CompanyResponse } from "../../src/types.js";

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

const company = (overrides: Partial<CompanyResponse> = {}): CompanyResponse => ({
  success: true,
  country: "LT",
  company_code: "100001919817",
  vat_code: "LT100001919817",
  name: "UAB PAVYZDYS",
  address: { city: "VILNIUS", country: "LT" },
  is_vat_valid: true,
  source: "VIES",
  ...overrides,
});

const key = { country: "LT", code: "100001919817" };

describe("cacheKey", () => {
  it("is case-insensitive", () => {
    expect(cacheKey({ country: "lt", code: "abc123" })).toBe(cacheKey({ country: "LT", code: "ABC123" }));
  });

  it("separates country from code", () => {
    expect(cacheKey(key)).toBe("LT:100001919817");
  });
});

describe("CompanyCache", () => {
  let cache: CompanyCache;

  beforeEach(() => {
    cache = new CompanyCache({ ttlMs: TWENTY_FOUR_HOURS, maxEntries: 3 });
  });

  it("misses before anything is stored", () => {
    expect(cache.get(key)).toBeUndefined();
    expect(cache.has(key)).toBe(false);
  });

  it("re-tags a hit as source CACHE without mutating the stored entry", () => {
    cache.set(key, company());
    expect(cache.get(key)?.source).toBe("CACHE");
    expect(cache.get(key)?.source).toBe("CACHE");
    expect(cache.get(key)?.name).toBe("UAB PAVYZDYS");
  });

  it("returns a copy so callers cannot corrupt the cached entry", () => {
    cache.set(key, company());
    const first = cache.get(key);
    first!.name = "MUTATED";
    first!.address.city = "MUTATED";
    expect(cache.get(key)?.name).toBe("UAB PAVYZDYS");
    expect(cache.get(key)?.address.city).toBe("VILNIUS");
  });

  it("does not store unsuccessful results", () => {
    cache.set(key, company({ success: false }));
    expect(cache.has(key)).toBe(false);
  });

  it("evicts the least recently used entry past the size limit", () => {
    for (const code of ["a1111", "b2222", "c3333", "d4444"]) {
      cache.set({ country: "LT", code }, company({ company_code: code }));
    }
    expect(cache.size).toBe(3);
    expect(cache.has({ country: "LT", code: "a1111" })).toBe(false);
    expect(cache.has({ country: "LT", code: "d4444" })).toBe(true);
  });

  it("supports explicit delete and clear", () => {
    cache.set(key, company());
    expect(cache.delete(key)).toBe(true);
    cache.set(key, company());
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("reports its configuration", () => {
    expect(cache.stats()).toEqual({ size: 0, max: 3, ttlMs: TWENTY_FOUR_HOURS });
  });
});

describe("CompanyCache TTL", () => {
  /** A controllable monotonic clock, so 24h can pass without waiting for it. */
  function fakeClock(): { now(): number; advance(ms: number): void } {
    // Starts above zero: lru-cache treats a zero insert timestamp as "no TTL set".
    let value = 1_000_000;
    return {
      now: () => value,
      advance: (ms: number) => {
        value += ms;
      },
    };
  }

  it("keeps an entry for just under 24 hours and drops it after", () => {
    const clock = fakeClock();
    const cache = new CompanyCache({ ttlMs: TWENTY_FOUR_HOURS, maxEntries: 10, clock });
    cache.set(key, company());

    clock.advance(TWENTY_FOUR_HOURS - 1000);
    expect(cache.get(key)?.source).toBe("CACHE");

    clock.advance(2000);
    expect(cache.get(key)).toBeUndefined();
    expect(cache.has(key)).toBe(false);
  });

  it("re-populating after expiry starts a fresh 24h window", () => {
    const clock = fakeClock();
    const cache = new CompanyCache({ ttlMs: TWENTY_FOUR_HOURS, maxEntries: 10, clock });
    cache.set(key, company());

    clock.advance(TWENTY_FOUR_HOURS + 1);
    expect(cache.get(key)).toBeUndefined();

    cache.set(key, company());
    clock.advance(TWENTY_FOUR_HOURS - 1000);
    expect(cache.get(key)?.source).toBe("CACHE");
  });
});
