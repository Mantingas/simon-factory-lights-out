/**
 * Cleans up what a buyer typed into something the lookup API can use.
 *
 * People paste company codes from invoices, emails and PDFs, so the input
 * arrives with spaces, dots, dashes, non-breaking spaces and — often — the VAT
 * country prefix in front. All of that is stripped here rather than sent on and
 * turned into a "company not found", which is the least helpful thing this
 * extension could tell someone whose code was perfectly correct.
 */

/** EU VAT prefixes, so a pasted VAT number is recognised whatever its country. */
const VAT_PREFIXES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK", "XI",
]);

export interface NormalizedCode {
  /** What to send to the API. */
  code: string;
  /** The prefix that was removed, if any. */
  strippedPrefix?: string;
}

/**
 * Uppercases, drops every separator, and removes a leading VAT country prefix.
 *
 * The prefix is only removed when something remains after it, so `LT` typed on
 * its own survives as-is and the field does not appear to eat what was typed.
 */
export function normalizeCompanyCode(raw: string): NormalizedCode {
  // \p{L}\p{N} rather than A-Z0-9: a stray Lithuanian letter should be dropped
  // as a typo, not silently mangled into something else.
  const cleaned = raw
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/[^A-Z0-9]/g, "");

  const prefix = cleaned.slice(0, 2);
  if (VAT_PREFIXES.has(prefix) && cleaned.length > 2) {
    return { code: cleaned.slice(2), strippedPrefix: prefix };
  }

  return { code: cleaned };
}

/** Countries this extension offers. */
export const SUPPORTED_COUNTRIES = ["LT", "PL", "LV", "EE"] as const;
export type SupportedCountry = (typeof SUPPORTED_COUNTRIES)[number];

export function isSupportedCountry(value: string | undefined): value is SupportedCountry {
  return (SUPPORTED_COUNTRIES as readonly string[]).includes(value ?? "");
}

/**
 * Picks the country to start on: the checkout's own country when it is one we
 * support, Lithuania otherwise.
 */
export function defaultCountry(checkoutCountry: string | undefined): SupportedCountry {
  const code = checkoutCountry?.toUpperCase();
  return isSupportedCountry(code) ? code : "LT";
}

/**
 * Whether a cleaned code is long enough to be worth a request. Deliberately
 * loose — each register decides what is valid, and rejecting a real code here
 * would be worse than one wasted lookup.
 */
export function looksSearchable(code: string): boolean {
  return /^[A-Z0-9]{6,20}$/.test(code);
}
