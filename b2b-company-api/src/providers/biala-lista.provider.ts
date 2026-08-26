import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { httpRequest } from "../utils/http.js";
import { isValidNip, normalizeCode } from "../utils/vat.js";
import type { CompanyLookupInput, VatEnricher, VatEnrichment } from "../types.js";

/** Subset of the `search/nip` payload this adapter reads. */
interface WhiteListSubject {
  name?: string | null;
  nip?: string | null;
  regon?: string | null;
  statusVat?: string | null;
  accountNumbers?: string[] | null;
}

interface WhiteListResponse {
  result?: {
    subject?: WhiteListSubject | null;
    requestId?: string;
    requestDateTime?: string;
  } | null;
  /** Present instead of `result` when the API rejects the request. */
  code?: string;
  message?: string;
}

/**
 * VAT statuses the register reports. Only an active payer (`Czynny`) may issue
 * VAT invoices — `Zwolniony` (exempt) and `Niezarejestrowany` (not registered)
 * both mean "do not treat this as a valid VAT counterparty".
 */
export const VAT_STATUS_ACTIVE = "Czynny";

export function isActiveVatStatus(status: string | null | undefined): boolean {
  return (status ?? "").trim().toLowerCase() === VAT_STATUS_ACTIVE.toLowerCase();
}

/**
 * The register is queried "as of" a date and rejects future ones. Poland is the
 * jurisdiction being queried, so the date is taken in Warsaw local time rather
 * than UTC — otherwise a late-evening request would ask about yesterday.
 */
export function warsawDate(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, which is exactly what the API expects.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Keeps only well-formed IBAN-ish account strings and drops duplicates. */
export function normalizeAccountNumbers(accounts: string[] | null | undefined): string[] {
  if (!Array.isArray(accounts)) return [];
  const seen = new Set<string>();
  for (const account of accounts) {
    if (typeof account !== "string") continue;
    const cleaned = account.replace(/[\s-]/g, "").toUpperCase();
    if (/^[A-Z0-9]{15,34}$/.test(cleaned)) seen.add(cleaned);
  }
  return [...seen];
}

export interface BialaListaProviderOptions {
  baseUrl?: string;
  /** Injected in tests so the "as of" date is deterministic. */
  today?: () => string;
}

/**
 * Polish Ministry of Finance "Biała Lista podatników VAT" (VAT white list).
 *
 * Free, unauthenticated, and the authoritative source for whether a Polish NIP
 * is an active VAT payer — which GUS, being the REGON *company* register,
 * cannot answer. It also publishes the entity's registered bank accounts.
 *
 * This is an enricher, not a lookup provider: it never fails a request. Any
 * error, timeout or unexpected payload returns `undefined`, leaving the caller
 * with the unenriched (`is_vat_valid: false`) result.
 */
export class BialaListaProvider implements VatEnricher {
  readonly name = "BIALA_LISTA" as const;
  private readonly baseUrl: string;
  private readonly today: () => string;

  constructor(options: BialaListaProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? config.WL_BASE_URL).replace(/\/+$/, "");
    this.today = options.today ?? (() => warsawDate());
  }

  supports(input: CompanyLookupInput): boolean {
    return input.country === "PL";
  }

  async enrich(nip: string, signal?: AbortSignal): Promise<VatEnrichment | undefined> {
    const digits = normalizeCode(nip);
    // The endpoint is `search/nip/{nip}`; anything else would be a guaranteed 400.
    if (!isValidNip(digits)) {
      logger.debug("biala lista skipped: not a NIP", { code: digits });
      return undefined;
    }

    const url = `${this.baseUrl}/api/search/nip/${digits}?date=${this.today()}`;

    try {
      const response = await httpRequest(url, {
        method: "GET",
        label: "Biała Lista",
        signal,
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        logger.warn("biala lista returned an error status", {
          status: response.status,
          nip: digits,
        });
        return undefined;
      }

      const payload = JSON.parse(response.body) as WhiteListResponse;

      // A body with no `result` at all is not an answer about this company —
      // treating it as "unregistered" would invent a VAT status out of a
      // maintenance page or a changed contract.
      if (payload.result === undefined || payload.result === null) {
        logger.warn("biala lista returned an unrecognised payload", { nip: digits });
        return undefined;
      }

      const subject = payload.result.subject;
      if (!subject) {
        // `result` present with a null subject is the register's own way of
        // saying the NIP is not on the white list.
        logger.debug("biala lista has no subject for nip", { nip: digits });
        return { is_vat_valid: false, vat_status: "Niezarejestrowany" };
      }

      const status = subject.statusVat?.trim();
      const accounts = normalizeAccountNumbers(subject.accountNumbers);

      return {
        is_vat_valid: isActiveVatStatus(status),
        ...(status ? { vat_status: status } : {}),
        ...(accounts.length > 0 ? { bank_accounts: accounts } : {}),
      };
    } catch (error) {
      // Deliberately swallowed: VAT status is an enhancement, not the answer.
      logger.warn("biala lista enrichment failed", {
        nip: digits,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}
