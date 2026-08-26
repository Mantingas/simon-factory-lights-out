import type {
  CompanyLookupInput,
  CompanyProvider,
  CompanyResponse,
  CompanySource,
  VatEnricher,
  VatEnrichment,
} from "../../src/types.js";

export interface StubProvider extends CompanyProvider {
  calls: CompanyLookupInput[];
}

/**
 * A provider whose behaviour is supplied per test: either a response factory or
 * an error to throw. Lets the service and route tests exercise routing, caching
 * and fallback without touching the SOAP/REST adapters.
 */
export function stubProvider(
  name: CompanySource,
  behaviour: ((input: CompanyLookupInput) => CompanyResponse) | Error,
  supports: (input: CompanyLookupInput) => boolean = () => true,
): StubProvider {
  const calls: CompanyLookupInput[] = [];
  return {
    name,
    calls,
    supports,
    async lookup(input: CompanyLookupInput): Promise<CompanyResponse> {
      calls.push(input);
      if (behaviour instanceof Error) throw behaviour;
      return behaviour(input);
    },
  };
}

export function companyFor(
  input: CompanyLookupInput,
  source: CompanySource,
  overrides: Partial<CompanyResponse> = {},
): CompanyResponse {
  return {
    success: true,
    country: input.country,
    company_code: input.code,
    vat_code: `${input.country}${input.code}`,
    name: `Company ${input.code}`,
    address: { city: "Somewhere", country: input.country },
    is_vat_valid: source === "VIES",
    source,
    ...overrides,
  };
}

/** A `VatEnricher` whose answer is fixed per test. */
export function stubEnricher(
  behaviour: ((nip: string) => VatEnrichment | undefined) | Error,
  supports: (input: CompanyLookupInput) => boolean = (input) => input.country === "PL",
): VatEnricher & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "BIALA_LISTA",
    calls,
    supports,
    async enrich(nip: string): Promise<VatEnrichment | undefined> {
      calls.push(nip);
      if (behaviour instanceof Error) throw behaviour;
      return behaviour(nip);
    },
  };
}
