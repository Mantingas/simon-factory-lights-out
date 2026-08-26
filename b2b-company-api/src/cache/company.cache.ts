import { LRUCache } from "lru-cache";
import { config } from "../config.js";
import type { CompanyLookupInput, CompanyResponse } from "../types.js";

export interface CompanyCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  /**
   * Monotonic clock used for TTL accounting. Defaults to `performance`; tests
   * inject a controllable one so expiry can be exercised without waiting.
   */
  clock?: { now(): number };
}

export function cacheKey(input: Pick<CompanyLookupInput, "country" | "code">): string {
  return `${input.country.toUpperCase()}:${input.code.toUpperCase()}`;
}

/**
 * 24h LRU of successful lookups. Only positive results are stored — a company
 * that was not found today may well be registered tomorrow, and caching misses
 * for a day would hide that.
 */
export class CompanyCache {
  private readonly store: LRUCache<string, CompanyResponse>;

  constructor(options: CompanyCacheOptions = {}) {
    this.store = new LRUCache<string, CompanyResponse>({
      max: options.maxEntries ?? config.CACHE_MAX_ENTRIES,
      ttl: options.ttlMs ?? config.CACHE_TTL_MS,
      ttlAutopurge: false,
      updateAgeOnGet: false,
      ...(options.clock ? { perf: options.clock, ttlResolution: 0 } : {}),
    });
  }

  /** Returns a hit re-tagged as `source: "CACHE"`, or `undefined` on a miss. */
  get(input: Pick<CompanyLookupInput, "country" | "code">): CompanyResponse | undefined {
    const hit = this.store.get(cacheKey(input));
    if (!hit) return undefined;
    return { ...hit, address: { ...hit.address }, source: "CACHE" };
  }

  set(input: Pick<CompanyLookupInput, "country" | "code">, value: CompanyResponse): void {
    if (!value.success) return;
    this.store.set(cacheKey(input), { ...value, address: { ...value.address } });
  }

  has(input: Pick<CompanyLookupInput, "country" | "code">): boolean {
    return this.store.has(cacheKey(input));
  }

  delete(input: Pick<CompanyLookupInput, "country" | "code">): boolean {
    return this.store.delete(cacheKey(input));
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  stats(): { size: number; max: number; ttlMs: number } {
    return {
      size: this.store.size,
      max: this.store.max,
      ttlMs: this.store.ttl,
    };
  }
}

/** Process-wide cache used by the HTTP layer; tests build their own instances. */
export const companyCache = new CompanyCache();
