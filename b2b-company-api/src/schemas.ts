import { z } from "zod";
import { normalizeCode, stripVatPrefix } from "./utils/vat.js";
import type { CompanyLookupInput } from "./types.js";

export const countrySchema = z
  .string({ required_error: "country is required" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "country must be a 2-letter ISO 3166-1 alpha-2 code (e.g. LT, LV, EE, PL, DE)");

export const codeSchema = z
  .string({ required_error: "code is required" })
  .trim()
  .min(1, "code is required")
  .max(32, "code must be at most 32 characters")
  .refine(
    (value) => /^[A-Za-z0-9]{3,20}$/.test(normalizeCode(value)),
    "code must contain 3-20 alphanumeric characters (separators such as spaces, dots and dashes are ignored)",
  );

export const companyQuerySchema = z.object({
  country: countrySchema,
  code: codeSchema,
});

export type CompanyQuery = z.infer<typeof companyQuerySchema>;

/**
 * Turns a validated query into the normalized input adapters consume: the code
 * is stripped of separators, and a leading VAT country prefix is removed and
 * recorded so the registry can route VAT questions to VIES.
 */
export function toLookupInput(query: CompanyQuery): CompanyLookupInput {
  const { code, prefix } = stripVatPrefix(query.code);
  return {
    country: query.country,
    code,
    rawCode: query.code,
    vatPrefixed: prefix !== undefined,
  };
}
