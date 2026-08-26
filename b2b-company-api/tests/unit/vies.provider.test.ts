import { afterEach, describe, expect, it } from "vitest";
import { ViesProvider, parseViesAddress } from "../../src/providers/vies.provider.js";
import { ApiError } from "../../src/errors.js";
import { stubFetch, type FetchStub } from "../helpers/fetch-mock.js";
import { VIES_INVALID, VIES_VALID, lookupInput } from "../helpers/fixtures.js";

const BASE_URL = "https://vies.test/rest-api";
const provider = new ViesProvider({ baseUrl: BASE_URL });

let stub: FetchStub | undefined;
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

const json = (payload: unknown, status = 200) => ({ status, body: JSON.stringify(payload) });

describe("parseViesAddress", () => {
  it("splits a Lithuanian address into street, postal code and city", () => {
    expect(parseViesAddress("GEDIMINO PR. 1\nLT-01103 VILNIUS")).toEqual({
      street: "GEDIMINO PR. 1",
      postal_code: "01103",
      city: "VILNIUS",
      full_address: "GEDIMINO PR. 1, LT-01103 VILNIUS",
    });
  });

  it("splits a Polish-style postal code", () => {
    expect(parseViesAddress("UL. CHEMIKOW 7\n09-411 PLOCK")).toMatchObject({
      postal_code: "09-411",
      city: "PLOCK",
    });
  });

  it("splits an Estonian-style postal code with no prefix", () => {
    expect(parseViesAddress("TARTU MNT 2\n10145 TALLINN")).toMatchObject({
      postal_code: "10145",
      city: "TALLINN",
    });
  });

  it("treats a single line as the street", () => {
    expect(parseViesAddress("SOME PLACE 1")).toEqual({
      street: "SOME PLACE 1",
      full_address: "SOME PLACE 1",
    });
  });

  it("falls back to city-only when the last line has no postal code", () => {
    expect(parseViesAddress("STREET 5\nRIGA")).toMatchObject({ street: "STREET 5", city: "RIGA" });
  });

  it("returns nothing for the placeholder VIES uses when it has no address", () => {
    expect(parseViesAddress("---")).toEqual({});
    expect(parseViesAddress(null)).toEqual({});
    expect(parseViesAddress(undefined)).toEqual({});
  });
});

describe("ViesProvider.supports", () => {
  it("covers EU member states including the Baltics", () => {
    for (const country of ["LT", "LV", "EE", "PL", "DE"]) {
      expect(provider.supports(lookupInput({ country }))).toBe(true);
    }
  });

  it("does not cover non-EU countries", () => {
    expect(provider.supports(lookupInput({ country: "US" }))).toBe(false);
  });
});

describe("ViesProvider.lookup", () => {
  it("posts the country code and VAT number as JSON", async () => {
    stub = stubFetch([json(VIES_VALID)]);
    await provider.lookup(lookupInput());

    const call = stub.calls[0];
    expect(call?.url).toBe(`${BASE_URL}/check-vat-number`);
    expect(call?.method).toBe("POST");
    expect(call?.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({
      countryCode: "LT",
      vatNumber: "100001919817",
    });
  });

  it("maps a valid response onto the normalized schema", async () => {
    stub = stubFetch([json(VIES_VALID)]);
    const result = await provider.lookup(lookupInput());

    expect(result).toEqual({
      success: true,
      country: "LT",
      company_code: "100001919817",
      vat_code: "LT100001919817",
      name: "UAB PAVYZDYS",
      address: {
        street: "GEDIMINO PR. 1",
        city: "VILNIUS",
        postal_code: "01103",
        country: "LT",
        full_address: "GEDIMINO PR. 1, LT-01103 VILNIUS",
      },
      is_vat_valid: true,
      source: "VIES",
    });
  });

  it("translates the ISO code Greece uses into the EL VAT prefix", async () => {
    stub = stubFetch([json({ ...VIES_VALID, countryCode: "EL" })]);
    const result = await provider.lookup(lookupInput({ country: "GR", code: "123456789" }));

    expect(JSON.parse(stub.calls[0]?.body ?? "{}").countryCode).toBe("EL");
    expect(result.vat_code).toBe("EL123456789");
    expect(result.country).toBe("GR");
  });

  it("keeps a placeholder name when the member state does not disclose one", async () => {
    stub = stubFetch([json({ ...VIES_VALID, name: "---" })]);
    const result = await provider.lookup(lookupInput());
    expect(result.name).toBe("(name not disclosed by member state)");
    expect(result.is_vat_valid).toBe(true);
  });

  it("raises NOT_FOUND when the VAT number is not registered", async () => {
    stub = stubFetch([json(VIES_INVALID)]);
    await expect(provider.lookup(lookupInput())).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("treats a member-state outage as an upstream error", async () => {
    stub = stubFetch([json({ ...VIES_INVALID, userError: "MS_UNAVAILABLE" })]);
    await expect(provider.lookup(lookupInput())).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      status: 502,
    });
  });

  it("treats a malformed VAT number as a validation error", async () => {
    stub = stubFetch([json({ ...VIES_INVALID, userError: "INVALID_INPUT" })]);
    await expect(provider.lookup(lookupInput())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("surfaces a non-JSON body as an upstream error", async () => {
    stub = stubFetch([{ status: 200, body: "<html>gateway</html>" }]);
    await expect(provider.lookup(lookupInput())).rejects.toBeInstanceOf(ApiError);
  });

  it("retries a 503 and succeeds on the next attempt", async () => {
    stub = stubFetch([{ status: 503, body: "unavailable" }, json(VIES_VALID)]);
    const result = await provider.lookup(lookupInput());
    expect(result.is_vat_valid).toBe(true);
    expect(stub.calls).toHaveLength(2);
  });

  it("gives up with an upstream error once retries are exhausted", async () => {
    stub = stubFetch([
      { status: 503, body: "unavailable" },
      { status: 503, body: "unavailable" },
      { status: 503, body: "unavailable" },
    ]);
    await expect(provider.lookup(lookupInput())).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
  });
});
