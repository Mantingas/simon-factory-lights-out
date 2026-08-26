/**
 * The single normalized shape every provider must map onto. Callers of the API
 * never see provider-specific fields — adapters are responsible for the mapping.
 */
export interface CompanyAddress {
  street?: string;
  city?: string;
  postal_code?: string;
  country: string;
  full_address?: string;
}

export interface CompanyResponse {
  success: boolean;
  country: string;
  company_code: string;
  vat_code?: string;
  name: string;
  address: CompanyAddress;
  is_vat_valid: boolean;
  source: CompanySource;
}

export type CompanySource = "VIES" | "GUS_BIR" | "CACHE";

export interface CompanyLookupInput {
  /** Upper-cased 2-letter ISO 3166-1 alpha-2 code. */
  country: string;
  /** Registration or VAT code, already stripped of separators and country prefix. */
  code: string;
  /** The code exactly as the caller supplied it, for echoing back. */
  rawCode: string;
  /** True when the caller supplied a VAT-prefixed code (e.g. `LT100001234567`). */
  vatPrefixed: boolean;
}

export interface CompanyProvider {
  readonly name: CompanySource;
  /** Countries this adapter can serve, or `"*"` for a catch-all. */
  supports(input: CompanyLookupInput): boolean;
  lookup(input: CompanyLookupInput, signal?: AbortSignal): Promise<CompanyResponse>;
}
