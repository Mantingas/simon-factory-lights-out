import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";
import { httpRequest } from "../utils/http.js";
import { asArray, escapeXml, parseXml, pick, text } from "../utils/xml.js";
import { classifyPolishIdentifier, normalizeCode } from "../utils/vat.js";
import type {
  CompanyLookupInput,
  CompanyProvider,
  CompanyResponse,
} from "../types.js";

const SOAP_ENV_NS = "http://www.w3.org/2003/05/soap-envelope";
const WSA_NS = "http://www.w3.org/2005/08/addressing";
/** `Zaloguj` / `Wyloguj` live in the 2014/07 contract... */
const SESSION_NS = "http://CIS/BIR/2014/07";
/** ...while the search operations live in the versioned PublDane contract. */
const SEARCH_NS = "http://CIS/BIR/PublDane/2021/11";
const SEARCH_DATA_NS = `${SEARCH_NS}/DataContract`;

/** GUS reports "nothing found" as an error code in the result payload. */
const NOT_FOUND_CODES = new Set(["4", "5", "6", "7"]);

interface GusEntity {
  regon?: string;
  nip?: string;
  name?: string;
  street?: string;
  buildingNumber?: string;
  flatNumber?: string;
  city?: string;
  postalCode?: string;
  postCity?: string;
  province?: string;
  county?: string;
  commune?: string;
  /** `P` = legal person, `F` = natural person, `LP`/`LF` = local unit. */
  type?: string;
  terminationDate?: string;
}

export interface GusProviderOptions {
  baseUrl?: string;
  userKey?: string;
}

function soapEnvelope(action: string, namespace: string, to: string, body: string): string {
  return [
    `<soap:Envelope xmlns:soap="${SOAP_ENV_NS}" xmlns:wsa="${WSA_NS}" xmlns:ns="${namespace}">`,
    "<soap:Header>",
    `<wsa:To>${escapeXml(to)}</wsa:To>`,
    `<wsa:Action>${namespace}/IUslugaBIRzewnPubl/${action}</wsa:Action>`,
    "</soap:Header>",
    `<soap:Body>${body}</soap:Body>`,
    "</soap:Envelope>",
  ].join("");
}

/** Formats a bare 5-digit Polish postal code as `NN-NNN`. */
export function formatPolishPostalCode(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 5) return raw;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Joins street, building and flat into the Polish `ul. X 12/3` convention. */
export function formatPolishStreet(entity: GusEntity): string | undefined {
  const parts: string[] = [];
  if (entity.street) parts.push(entity.street);
  if (entity.buildingNumber) {
    parts.push(entity.flatNumber ? `${entity.buildingNumber}/${entity.flatNumber}` : entity.buildingNumber);
  }
  const street = parts.join(" ").trim();
  return street.length > 0 ? street : undefined;
}

/**
 * Extracts the `<dane>` records from a `DaneSzukajPodmiotyResult`. GUS returns
 * the payload as an XML *string* nested inside the SOAP response, so the
 * envelope and the payload are parsed in two passes.
 */
export function parseGusSearchResult(resultXml: string): GusEntity[] {
  const trimmed = resultXml.trim();
  if (trimmed.length === 0) return [];

  const parsed = parseXml(trimmed);
  const errorCode = text(pick(parsed, "root", "dane", "ErrorCode"));
  if (errorCode && NOT_FOUND_CODES.has(errorCode)) return [];

  const dane = asArray(pick(parsed, "root", "dane") as unknown);
  return dane
    .filter((node): node is Record<string, unknown> => node !== null && typeof node === "object")
    .map((node) => ({
      regon: text(node["Regon"]),
      nip: text(node["Nip"]),
      name: text(node["Nazwa"]),
      street: text(node["Ulica"]),
      buildingNumber: text(node["NrNieruchomosci"]),
      flatNumber: text(node["NrLokalu"]),
      city: text(node["Miejscowosc"]),
      postalCode: text(node["KodPocztowy"]),
      postCity: text(node["MiejscowoscPoczty"]),
      province: text(node["Wojewodztwo"]),
      county: text(node["Powiat"]),
      commune: text(node["Gmina"]),
      type: text(node["Typ"]),
      terminationDate: text(node["DataZakonczeniaDzialalnosci"]),
    }))
    .filter((entity) => entity.regon !== undefined || entity.nip !== undefined);
}

/**
 * Polish REGON register (GUS BIR1.1 SOAP API).
 *
 * Each lookup runs a full `Zaloguj` -> `DaneSzukajPodmioty` -> `Wyloguj` cycle.
 * Sessions are deliberately not pooled: GUS expires them server-side after
 * ~60 minutes of inactivity and a stale `sid` fails the search rather than
 * re-authenticating, so a short-lived session per request is the reliable shape.
 */
export class GusProvider implements CompanyProvider {
  readonly name = "GUS_BIR" as const;
  private readonly baseUrl: string;
  private readonly userKey: string;

  constructor(options: GusProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? config.GUS_BASE_URL;
    this.userKey = options.userKey ?? config.GUS_USER_KEY;
  }

  supports(input: CompanyLookupInput): boolean {
    return input.country === "PL";
  }

  async lookup(input: CompanyLookupInput, signal?: AbortSignal): Promise<CompanyResponse> {
    const code = normalizeCode(input.code);
    const kind = classifyPolishIdentifier(code);
    if (kind === "UNKNOWN") {
      throw ApiError.validation(
        "A Polish company code must be a 10-digit NIP or a 9/14-digit REGON.",
        { code: input.rawCode },
      );
    }

    const sid = await this.login(signal);
    try {
      const entities = await this.search(sid, kind, code, signal);
      const entity = entities[0];
      if (!entity) {
        throw ApiError.notFound(`No Polish entity found for ${kind} ${code}.`, {
          country: "PL",
          code,
        });
      }
      return this.toCompanyResponse(input, entity);
    } finally {
      // Best effort: an orphaned session expires on its own, so a failed logout
      // must never mask the lookup's own result.
      await this.logout(sid).catch((error: unknown) => {
        logger.warn("gus logout failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  private async login(signal?: AbortSignal): Promise<string> {
    const body = `<ns:Zaloguj><ns:pKluczUzytkownika>${escapeXml(this.userKey)}</ns:pKluczUzytkownika></ns:Zaloguj>`;
    const response = await httpRequest(this.baseUrl, {
      method: "POST",
      label: "GUS BIR (Zaloguj)",
      signal,
      headers: { "content-type": "application/soap+xml;charset=UTF-8" },
      body: soapEnvelope("Zaloguj", SESSION_NS, this.baseUrl, body),
    });

    if (!response.ok) {
      throw ApiError.upstream(`GUS BIR login responded with HTTP ${response.status}.`, {
        status: response.status,
      });
    }

    const sid = text(pick(parseXml(response.body), "Envelope", "Body", "ZalogujResponse", "ZalogujResult"));
    if (!sid) {
      throw ApiError.upstream(
        "GUS BIR rejected the user key — no session id was returned.",
      );
    }

    logger.debug("gus session opened");
    return sid;
  }

  private async search(
    sid: string,
    kind: "NIP" | "REGON",
    code: string,
    signal?: AbortSignal,
  ): Promise<GusEntity[]> {
    const field = kind === "NIP" ? "Nip" : "Regon";
    const body = [
      "<ns:DaneSzukajPodmioty>",
      "<ns:pParametryWyszukiwania>",
      `<dat:${field} xmlns:dat="${SEARCH_DATA_NS}">${escapeXml(code)}</dat:${field}>`,
      "</ns:pParametryWyszukiwania>",
      "</ns:DaneSzukajPodmioty>",
    ].join("");

    const response = await httpRequest(this.baseUrl, {
      method: "POST",
      label: "GUS BIR (DaneSzukajPodmioty)",
      signal,
      headers: { "content-type": "application/soap+xml;charset=UTF-8", sid },
      body: soapEnvelope("DaneSzukajPodmioty", SEARCH_NS, this.baseUrl, body),
    });

    if (!response.ok) {
      throw ApiError.upstream(`GUS BIR search responded with HTTP ${response.status}.`, {
        status: response.status,
      });
    }

    const result = text(
      pick(
        parseXml(response.body),
        "Envelope",
        "Body",
        "DaneSzukajPodmiotyResponse",
        "DaneSzukajPodmiotyResult",
      ),
    );
    if (!result) return [];
    return parseGusSearchResult(result);
  }

  private async logout(sid: string): Promise<void> {
    const body = `<ns:Wyloguj><ns:pIdentyfikatorSesji>${escapeXml(sid)}</ns:pIdentyfikatorSesji></ns:Wyloguj>`;
    await httpRequest(this.baseUrl, {
      method: "POST",
      label: "GUS BIR (Wyloguj)",
      retries: 0,
      headers: { "content-type": "application/soap+xml;charset=UTF-8", sid },
      body: soapEnvelope("Wyloguj", SESSION_NS, this.baseUrl, body),
    });
  }

  private toCompanyResponse(input: CompanyLookupInput, entity: GusEntity): CompanyResponse {
    const street = formatPolishStreet(entity);
    const postal_code = formatPolishPostalCode(entity.postalCode);
    const city = entity.city ?? entity.postCity;
    const full_address = [street, [postal_code, city].filter(Boolean).join(" ") || undefined, "Poland"]
      .filter((part): part is string => Boolean(part))
      .join(", ");

    return {
      success: true,
      country: "PL",
      company_code: entity.regon ?? input.code,
      ...(entity.nip ? { vat_code: `PL${entity.nip}` } : {}),
      name: entity.name ?? "(name not provided by GUS)",
      address: {
        ...(street ? { street } : {}),
        ...(city ? { city } : {}),
        ...(postal_code ? { postal_code } : {}),
        country: "PL",
        full_address,
      },
      // GUS is the REGON register, not a VAT register: it confirms the entity is
      // registered and still active, but says nothing about VAT status. Confirm
      // VAT separately via VIES.
      is_vat_valid: false,
      source: this.name,
    };
  }
}
