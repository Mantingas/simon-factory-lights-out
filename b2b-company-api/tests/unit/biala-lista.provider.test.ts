import { afterEach, describe, expect, it } from "vitest";
import {
  BialaListaProvider,
  isActiveVatStatus,
  normalizeAccountNumbers,
  warsawDate,
} from "../../src/providers/biala-lista.provider.js";
import { stubFetch, type FetchStub } from "../helpers/fetch-mock.js";
import {
  NIP_ORLEN,
  REGON9_ORLEN,
  WL_ACCOUNT,
  WL_ACTIVE,
  WL_API_ERROR,
  WL_EXEMPT,
  WL_NO_SUBJECT,
  lookupInput,
} from "../helpers/fixtures.js";

const BASE_URL = "https://wl.test";
const provider = new BialaListaProvider({ baseUrl: BASE_URL, today: () => "2026-08-26" });

const json = (payload: unknown, status = 200) => ({ status, body: JSON.stringify(payload) });

let stub: FetchStub | undefined;
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

describe("isActiveVatStatus", () => {
  it("recognises an active payer", () => {
    expect(isActiveVatStatus("Czynny")).toBe(true);
    expect(isActiveVatStatus(" czynny ")).toBe(true);
  });

  it("treats exempt, unregistered, missing and unknown values as not valid", () => {
    expect(isActiveVatStatus("Zwolniony")).toBe(false);
    expect(isActiveVatStatus("Niezarejestrowany")).toBe(false);
    expect(isActiveVatStatus(null)).toBe(false);
    expect(isActiveVatStatus(undefined)).toBe(false);
    expect(isActiveVatStatus("")).toBe(false);
  });
});

describe("warsawDate", () => {
  it("formats as YYYY-MM-DD", () => {
    expect(warsawDate(new Date("2026-08-26T12:00:00Z"))).toBe("2026-08-26");
  });

  it("uses Warsaw local time, not UTC", () => {
    // 22:30 UTC is already the next day in Warsaw (UTC+2 in August).
    expect(warsawDate(new Date("2026-08-26T22:30:00Z"))).toBe("2026-08-27");
  });
});

describe("normalizeAccountNumbers", () => {
  it("strips separators, upper-cases and de-duplicates", () => {
    expect(
      normalizeAccountNumbers([WL_ACCOUNT, `${WL_ACCOUNT.slice(0, 4)} ${WL_ACCOUNT.slice(4)}`]),
    ).toEqual([WL_ACCOUNT]);
  });

  it("drops values that cannot be account numbers", () => {
    expect(normalizeAccountNumbers(["123", "", "not-an-iban!!"])).toEqual([]);
  });

  it("tolerates a missing or non-array field", () => {
    expect(normalizeAccountNumbers(undefined)).toEqual([]);
    expect(normalizeAccountNumbers(null)).toEqual([]);
    expect(normalizeAccountNumbers("nope" as unknown as string[])).toEqual([]);
  });
});

describe("BialaListaProvider.supports", () => {
  it("only claims Poland", () => {
    expect(provider.supports(lookupInput({ country: "PL" }))).toBe(true);
    expect(provider.supports(lookupInput({ country: "LT" }))).toBe(false);
  });
});

describe("BialaListaProvider.enrich", () => {
  it("calls search/nip with the as-of date", async () => {
    stub = stubFetch([json(WL_ACTIVE)]);
    await provider.enrich(NIP_ORLEN);

    expect(stub.calls[0]?.url).toBe(`${BASE_URL}/api/search/nip/${NIP_ORLEN}?date=2026-08-26`);
    expect(stub.calls[0]?.method).toBe("GET");
  });

  it("maps an active payer to a valid VAT status with bank accounts", async () => {
    stub = stubFetch([json(WL_ACTIVE)]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toEqual({
      is_vat_valid: true,
      vat_status: "Czynny",
      bank_accounts: [WL_ACCOUNT],
    });
  });

  it("maps an exempt payer to an invalid VAT status and omits empty accounts", async () => {
    stub = stubFetch([json(WL_EXEMPT)]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toEqual({
      is_vat_valid: false,
      vat_status: "Zwolniony",
    });
  });

  it("treats a well-formed NIP with no subject as not registered", async () => {
    stub = stubFetch([json(WL_NO_SUBJECT)]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toEqual({
      is_vat_valid: false,
      vat_status: "Niezarejestrowany",
    });
  });

  it("accepts a formatted NIP", async () => {
    stub = stubFetch([json(WL_ACTIVE)]);
    await provider.enrich("774-000-14-54");
    expect(stub.calls[0]?.url).toContain(`/api/search/nip/${NIP_ORLEN}?`);
  });

  it("skips the call entirely for something that is not a NIP", async () => {
    stub = stubFetch([]);
    await expect(provider.enrich(REGON9_ORLEN)).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(0);
  });

  it("returns undefined — not an error — when the API rejects the request", async () => {
    stub = stubFetch([json(WL_API_ERROR, 400)]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toBeUndefined();
  });

  it("returns undefined when the service is unreachable", async () => {
    stub = stubFetch([
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
      new Error("ECONNREFUSED"),
    ]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toBeUndefined();
  });

  it("returns undefined when the body is not JSON", async () => {
    stub = stubFetch([{ status: 200, body: "<html>maintenance</html>" }]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toBeUndefined();
  });

  it("returns undefined when the payload has an unexpected shape", async () => {
    stub = stubFetch([json({ unexpected: true })]);
    await expect(provider.enrich(NIP_ORLEN)).resolves.toBeUndefined();
  });
});
