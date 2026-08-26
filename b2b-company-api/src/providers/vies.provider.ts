import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";
import { httpRequest } from "../utils/http.js";
import { isEuVatCountry, toViesCountryCode } from "../utils/vat.js";
import type {
  CompanyLookupInput,
  CompanyProvider,
  CompanyResponse,
} from "../types.js";

/** Shape of `POST /check-vat-number` as returned by the VIES REST API. */
interface ViesCheckVatResponse {
  countryCode?: string;
  vatNumber?: string;
  requestDate?: string;
  valid?: boolean;
  name?: string | null;
  address?: string | null;
  userError?: string | null;
}

/**
 * VIES only reports "valid / not valid" plus an optional trader name and
 * address; these are the failure codes it returns instead of a result. They are
 * split by whether retrying could ever help.
 */
const USER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_INPUT: "VIES rejected the VAT number format for this member state.",
  INVALID_REQUESTER_INFO: "VIES rejected the requester information.",
  SERVICE_UNAVAILABLE: "The VIES service is temporarily unavailable.",
  MS_UNAVAILABLE: "The member state VAT register is temporarily unavailable.",
  MS_MAX_CONCURRENT_REQ: "The member state VAT register is rate limiting requests.",
  TIMEOUT: "The member state VAT register did not respond in time.",
  VAT_BLOCKED: "The member state blocked this VAT lookup.",
  IP_BLOCKED: "VIES blocked this client's IP address.",
  GLOBAL_MAX_CONCURRENT_REQ: "VIES is rate limiting requests globally.",
};

const TRANSIENT_USER_ERRORS = new Set([
  "SERVICE_UNAVAILABLE",
  "MS_UNAVAILABLE",
  "MS_MAX_CONCURRENT_REQ",
  "TIMEOUT",
  "GLOBAL_MAX_CONCURRENT_REQ",
]);

/**
 * VIES returns the address as a single newline-separated blob whose last line
 * is `POSTCODE CITY` for most member states. We keep the raw blob in
 * `full_address` and only split out fields we can identify with confidence.
 */
export function parseViesAddress(raw: string | null | undefined): {
  street?: string;
  city?: string;
  postal_code?: string;
  full_address?: string;
} {
  const cleaned = (raw ?? "").replace(/\r/g, "").trim();
  if (cleaned.length === 0 || cleaned === "---") return {};

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const full_address = lines.join(", ");

  if (lines.length === 0) return {};
  if (lines.length === 1) return { street: lines[0], full_address };

  const last = lines[lines.length - 1] as string;
  const street = lines.slice(0, -1).join(", ");

  // Matches `LT-01100 VILNIUS`, `01-234 WARSZAWA`, `10111 TALLINN`.
  const match = last.match(/^(?:[A-Z]{2}[- ])?(\d[\d\s-]{2,9}\d)\s+(.+)$/);
  if (match) {
    return {
      street,
      postal_code: (match[1] as string).replace(/\s+/g, ""),
      city: (match[2] as string).trim(),
      full_address,
    };
  }

  return { street, city: last, full_address };
}

export interface ViesProviderOptions {
  baseUrl?: string;
}

/**
 * EU VAT information exchange system. Serves LT, LV, EE and every other member
 * state, and is also the adapter used whenever the caller supplies a
 * VAT-prefixed (PVM/PVN/KMKR) code.
 */
export class ViesProvider implements CompanyProvider {
  readonly name = "VIES" as const;
  private readonly baseUrl: string;

  constructor(options: ViesProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.VIES_BASE_URL).replace(/\/+$/, "");
  }

  supports(input: CompanyLookupInput): boolean {
    return isEuVatCountry(input.country);
  }

  async lookup(input: CompanyLookupInput, signal?: AbortSignal): Promise<CompanyResponse> {
    const countryCode = toViesCountryCode(input.country);
    const vatNumber = input.code;

    logger.debug("vies lookup", { countryCode, vatNumber });

    const response = await httpRequest(`${this.baseUrl}/check-vat-number`, {
      method: "POST",
      label: "VIES",
      signal,
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ countryCode, vatNumber }),
    });

    if (!response.ok) {
      throw ApiError.upstream(`VIES responded with HTTP ${response.status}.`, {
        status: response.status,
      });
    }

    let payload: ViesCheckVatResponse;
    try {
      payload = JSON.parse(response.body) as ViesCheckVatResponse;
    } catch {
      throw ApiError.upstream("VIES returned a response that is not valid JSON.");
    }

    const userError = payload.userError ?? undefined;
    if (userError && userError !== "VALID" && userError !== "INVALID") {
      const message = USER_ERROR_MESSAGES[userError] ?? `VIES returned '${userError}'.`;
      throw TRANSIENT_USER_ERRORS.has(userError)
        ? ApiError.upstream(message, { userError })
        : ApiError.validation(message, { userError });
    }

    if (payload.valid !== true) {
      throw ApiError.notFound(
        `VAT number ${countryCode}${vatNumber} is not registered in VIES.`,
        { country: countryCode, code: vatNumber },
      );
    }

    const address = parseViesAddress(payload.address);
    const name = (payload.name ?? "").trim();

    return {
      success: true,
      country: input.country,
      company_code: input.code,
      vat_code: `${countryCode}${vatNumber}`,
      // VIES hides the trader name for member states that opted out of disclosure.
      name: name.length > 0 && name !== "---" ? name : "(name not disclosed by member state)",
      address: { ...address, country: input.country },
      is_vat_valid: true,
      source: this.name,
    };
  }
}
