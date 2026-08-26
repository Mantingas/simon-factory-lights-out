/**
 * EU member states plus the Northern Ireland (`XI`) prefix that VIES accepts.
 * `EL` is the VAT prefix Greece uses instead of its ISO code `GR`.
 */
export const EU_VAT_COUNTRIES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR",
  "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO",
  "SE", "SI", "SK", "XI",
] as const;

export type EuVatCountry = (typeof EU_VAT_COUNTRIES)[number];

const EU_VAT_SET: ReadonlySet<string> = new Set(EU_VAT_COUNTRIES);

/** ISO alpha-2 codes accepted at the edge, mapped to the prefix VIES expects. */
const ISO_TO_VIES: Readonly<Record<string, string>> = { GR: "EL", GB: "XI" };

export function toViesCountryCode(country: string): string {
  const iso = country.trim().toUpperCase();
  return ISO_TO_VIES[iso] ?? iso;
}

export function isEuVatCountry(country: string): boolean {
  return EU_VAT_SET.has(toViesCountryCode(country));
}

/** Strips spaces, dots and dashes; upper-cases. Does not remove a country prefix. */
export function normalizeCode(code: string): string {
  return code.replace(/[\s.\-/]/g, "").toUpperCase();
}

export interface StrippedVatCode {
  /** The code with any leading country prefix removed. */
  code: string;
  /** The prefix that was removed, if any (in VIES form, e.g. `EL`). */
  prefix?: string;
}

/**
 * Removes a leading VAT country prefix when the caller included one
 * (`LT100001234567` -> `100001234567`). A prefix is only stripped when it is a
 * known EU VAT prefix *and* something remains after it, so a purely numeric
 * registration code is never mangled.
 */
export function stripVatPrefix(code: string): StrippedVatCode {
  const normalized = normalizeCode(code);
  const prefix = normalized.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(prefix)) return { code: normalized };
  if (!EU_VAT_SET.has(prefix)) return { code: normalized };
  const rest = normalized.slice(2);
  if (rest.length === 0) return { code: normalized };
  return { code: rest, prefix };
}

/** Polish NIP: 10 digits with a weighted mod-11 checksum. */
export function isValidNip(code: string): boolean {
  const digits = normalizeCode(code);
  if (!/^\d{10}$/.test(digits)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const sum = weights.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const checksum = sum % 11;
  return checksum !== 10 && checksum === Number(digits[9]);
}

/** Polish REGON: 9 or 14 digits with a weighted mod-11 checksum. */
export function isValidRegon(code: string): boolean {
  const digits = normalizeCode(code);
  if (!/^(\d{9}|\d{14})$/.test(digits)) return false;
  const weights = digits.length === 9
    ? [8, 9, 2, 3, 4, 5, 6, 7]
    : [2, 4, 8, 5, 0, 9, 7, 3, 6, 1, 2, 4, 8];
  const sum = weights.reduce((acc, weight, i) => acc + weight * Number(digits[i]), 0);
  const checksum = sum % 11 === 10 ? 0 : sum % 11;
  return checksum === Number(digits[digits.length - 1]);
}

export type PolishIdentifierKind = "NIP" | "REGON" | "UNKNOWN";

/**
 * Classifies a Polish identifier so the GUS adapter knows which search
 * parameter to send. Checksums decide ambiguous cases; length is the fallback
 * so a mistyped-but-well-formed code still reaches the right search field.
 */
export function classifyPolishIdentifier(code: string): PolishIdentifierKind {
  const digits = normalizeCode(code);
  if (!/^\d+$/.test(digits)) return "UNKNOWN";
  if (isValidNip(digits)) return "NIP";
  if (isValidRegon(digits)) return "REGON";
  if (digits.length === 10) return "NIP";
  if (digits.length === 9 || digits.length === 14) return "REGON";
  return "UNKNOWN";
}
