import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";
import { CompanyCache, companyCache } from "../cache/company.cache.js";
import { ProviderRegistry, providerRegistry } from "../providers/index.js";
import { BialaListaProvider } from "../providers/biala-lista.provider.js";
import type { CompanyLookupInput, CompanyResponse, VatEnricher } from "../types.js";

export interface CompanyServiceOptions {
  registry?: ProviderRegistry;
  cache?: CompanyCache;
  /** Pass `null` to disable enrichment entirely. */
  vatEnricher?: VatEnricher | null;
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
  private readonly vatEnricher: VatEnricher | undefined;

  constructor(options: CompanyServiceOptions = {}) {
    this.registry = options.registry ?? providerRegistry;
    this.cache = options.cache ?? companyCache;
    this.vatEnricher =
      options.vatEnricher === null
        ? undefined
        : (options.vatEnricher ?? (config.WL_ENABLED ? new BialaListaProvider() : undefined));
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
        const raw = await provider.lookup(input, options.signal);
        const result = await this.enrich(input, raw, options.signal);
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

  /**
   * Adds VAT-register data a company register cannot supply.
   *
   * Only GUS results are enriched: GUS is the REGON *company* register and
   * always reports `is_vat_valid: false`, whereas a VIES result already carries
   * an authoritative VAT answer that a second opinion could only contradict.
   *
   * Enrichment never fails the lookup — on any problem the unenriched result is
   * returned as-is.
   */
  private async enrich(
    input: CompanyLookupInput,
    result: CompanyResponse,
    signal?: AbortSignal,
  ): Promise<CompanyResponse> {
    const enricher = this.vatEnricher;
    if (!enricher || result.source !== "GUS_BIR") return result;
    if (!enricher.supports(input)) return result;

    // Prefer the NIP the register itself returned; fall back to the queried
    // code, which is a NIP whenever the caller searched by one.
    const nip = result.vat_code?.replace(/^PL/i, "") ?? input.code;

    const enrichment = await enricher.enrich(nip, signal);
    if (!enrichment) {
      logger.debug("vat enrichment unavailable", { provider: enricher.name, nip });
      return result;
    }

    return {
      ...result,
      is_vat_valid: enrichment.is_vat_valid,
      ...(enrichment.vat_status ? { vat_status: enrichment.vat_status } : {}),
      ...(enrichment.bank_accounts ? { bank_accounts: enrichment.bank_accounts } : {}),
      enriched_by: [...(result.enriched_by ?? []), enricher.name],
    };
  }

  cacheStats(): ReturnType<CompanyCache["stats"]> {
    return this.cache.stats();
  }
}

export const companyService = new CompanyService();
