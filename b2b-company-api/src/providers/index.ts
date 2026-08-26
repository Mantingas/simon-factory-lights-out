import { ApiError } from "../errors.js";
import { classifyPolishIdentifier, isEuVatCountry } from "../utils/vat.js";
import type { CompanyLookupInput, CompanyProvider } from "../types.js";
import { GusProvider } from "./gus.provider.js";
import { ViesProvider } from "./vies.provider.js";

export { GusProvider } from "./gus.provider.js";
export { ViesProvider } from "./vies.provider.js";

export interface ProviderRegistryOptions {
  gus?: CompanyProvider;
  vies?: CompanyProvider;
}

/**
 * Decides which adapter answers a lookup, and in what order.
 *
 * The rules, highest priority first:
 *  1. A VAT-prefixed code (`LT1000…`, `PL526…`) is a VAT question -> VIES.
 *  2. Poland -> the GUS REGON register, which returns full registry data.
 *     A Polish NIP is also a VAT number, so VIES stays available as a fallback.
 *  3. Any other EU member state -> VIES.
 *  4. Everything else -> unsupported.
 */
export class ProviderRegistry {
  private readonly gus: CompanyProvider;
  private readonly vies: CompanyProvider;

  constructor(options: ProviderRegistryOptions = {}) {
    this.gus = options.gus ?? new GusProvider();
    this.vies = options.vies ?? new ViesProvider();
  }

  /** Ordered adapters to try. Later entries are fallbacks, used only on upstream failure. */
  resolve(input: CompanyLookupInput): CompanyProvider[] {
    if (input.country === "PL") {
      if (input.vatPrefixed) return [this.vies, this.gus];
      const chain: CompanyProvider[] = [this.gus];
      if (classifyPolishIdentifier(input.code) === "NIP") chain.push(this.vies);
      return chain;
    }

    if (isEuVatCountry(input.country)) return [this.vies];

    throw ApiError.unsupportedCountry(input.country);
  }
}

export const providerRegistry = new ProviderRegistry();
