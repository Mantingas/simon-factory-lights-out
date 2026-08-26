import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";
import { CompanyCache, companyCache } from "../cache/company.cache.js";
import { ProviderRegistry, providerRegistry } from "../providers/index.js";
import type { CompanyLookupInput, CompanyResponse } from "../types.js";

export interface CompanyServiceOptions {
  registry?: ProviderRegistry;
  cache?: CompanyCache;
}

export interface LookupOptions {
  /** Bypasses the cache read; a fresh result still populates it. */
  refresh?: boolean;
  signal?: AbortSignal;
}

/** Only an upstream problem justifies falling through to the next adapter. */
function isFallbackWorthy(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "UPSTREAM_ERROR" ||
      error.code === "UPSTREAM_TIMEOUT" ||
      error.code === "RATE_LIMITED")
  );
}

export class CompanyService {
  private readonly registry: ProviderRegistry;
  private readonly cache: CompanyCache;

  constructor(options: CompanyServiceOptions = {}) {
    this.registry = options.registry ?? providerRegistry;
    this.cache = options.cache ?? companyCache;
  }

  async lookup(input: CompanyLookupInput, options: LookupOptions = {}): Promise<CompanyResponse> {
    if (!options.refresh) {
      const cached = this.cache.get(input);
      if (cached) {
        logger.debug("cache hit", { country: input.country, code: input.code });
        return cached;
      }
    }

    const providers = this.registry.resolve(input);
    let lastError: unknown;

    for (const [index, provider] of providers.entries()) {
      try {
        const result = await provider.lookup(input, options.signal);
        this.cache.set(input, result);
        logger.info("lookup resolved", {
          country: input.country,
          code: input.code,
          source: result.source,
        });
        return result;
      } catch (error) {
        lastError = error;
        if (!isFallbackWorthy(error)) throw error;
        logger.warn("provider failed", {
          provider: provider.name,
          fallbacksRemaining: providers.length - index - 1,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    throw lastError instanceof ApiError
      ? lastError
      : ApiError.upstream("All providers failed for this lookup.");
  }

  cacheStats(): ReturnType<CompanyCache["stats"]> {
    return this.cache.stats();
  }
}

export const companyService = new CompanyService();
