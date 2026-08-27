import type { SupportedCountry } from "./normalize";

export const DEFAULT_API_BASE_URL = "https://b2b-company-api-production.up.railway.app";

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
  source: string;
  vat_status?: string;
  bank_accounts?: string[];
  enriched_by?: string[];
  deregistered_at?: string;
}

/**
 * Every way a lookup can end, as a closed set.
 *
 * The component renders a different message for each, so they are kept distinct
 * rather than collapsed into "error": telling someone their code was not found
 * when the service was actually down would send them hunting for a mistake they
 * did not make.
 */
export type LookupOutcome =
  | { status: "found"; company: CompanyResponse }
  | { status: "notFound" }
  | { status: "invalid" }
  | { status: "rateLimited" }
  | { status: "unavailable" };

const REQUEST_TIMEOUT_MS = 12_000;

export interface LookupOptions {
  baseUrl?: string;
  signal?: AbortSignal;
}

export async function lookupCompany(
  country: SupportedCountry,
  code: string,
  options: LookupOptions = {},
): Promise<LookupOutcome> {
  const base = (options.baseUrl?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const url = `${base}/api/v1/company/${encodeURIComponent(country)}/${encodeURIComponent(code)}`;

  // Checkout must never be left waiting on a slow register — the buyer can
  // always fill the fields in by hand, and a spinner that never resolves is
  // worse than a message that says so.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout.signal])
    : timeout.signal;

  try {
    const response = await fetch(url, { method: "GET", headers: { accept: "application/json" }, signal });

    if (response.ok) {
      const company = (await response.json()) as CompanyResponse;
      return company?.success && company.name ? { status: "found", company } : { status: "notFound" };
    }

    if (response.status === 404) return { status: "notFound" };
    if (response.status === 400 || response.status === 422) return { status: "invalid" };
    if (response.status === 429) return { status: "rateLimited" };
    return { status: "unavailable" };
  } catch {
    // Aborts, DNS failures and CORS rejections all land here and all mean the
    // same thing to a buyer: it did not work, type it in yourself.
    return { status: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}
