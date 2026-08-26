import { describe, expect, it } from "vitest";
import {
  classifyPolishIdentifier,
  isEuVatCountry,
  isValidNip,
  isValidRegon,
  normalizeCode,
  stripVatPrefix,
  toViesCountryCode,
} from "../../src/utils/vat.js";
import { NIP_INVALID_CHECKSUM, NIP_ORLEN, REGON14, REGON9_ORLEN } from "../helpers/fixtures.js";

describe("normalizeCode", () => {
  it("strips separators and upper-cases", () => {
    expect(normalizeCode(" lt 100-001.919/817 ")).toBe("LT100001919817");
  });
});

describe("toViesCountryCode", () => {
  it("maps Greece's ISO code to its VAT prefix", () => {
    expect(toViesCountryCode("gr")).toBe("EL");
  });

  it("maps GB to the Northern Ireland prefix VIES accepts", () => {
    expect(toViesCountryCode("GB")).toBe("XI");
  });

  it("passes other codes through upper-cased", () => {
    expect(toViesCountryCode("lt")).toBe("LT");
  });
});

describe("isEuVatCountry", () => {
  it.each(["LT", "LV", "EE", "PL", "DE", "GR", "gb"])("accepts %s", (country) => {
    expect(isEuVatCountry(country)).toBe(true);
  });

  it.each(["US", "CH", "NO", "UA"])("rejects %s", (country) => {
    expect(isEuVatCountry(country)).toBe(false);
  });
});

describe("stripVatPrefix", () => {
  it("removes a known EU VAT prefix", () => {
    expect(stripVatPrefix("LT100001919817")).toEqual({ code: "100001919817", prefix: "LT" });
  });

  it("normalizes before stripping", () => {
    expect(stripVatPrefix("pl 777-000-14-54")).toEqual({ code: "7770001454", prefix: "PL" });
  });

  it("leaves a purely numeric registration code untouched", () => {
    expect(stripVatPrefix(REGON9_ORLEN)).toEqual({ code: REGON9_ORLEN });
  });

  it("leaves an unknown two-letter prefix untouched", () => {
    expect(stripVatPrefix("US12345678")).toEqual({ code: "US12345678" });
  });

  it("does not strip when nothing would remain", () => {
    expect(stripVatPrefix("LT")).toEqual({ code: "LT" });
  });
});

describe("isValidNip", () => {
  it("accepts a real NIP", () => {
    expect(isValidNip(NIP_ORLEN)).toBe(true);
  });

  it("accepts a formatted NIP", () => {
    expect(isValidNip("774-000-14-54")).toBe(true);
  });

  it("rejects a wrong checksum digit", () => {
    expect(isValidNip(NIP_INVALID_CHECKSUM)).toBe(false);
  });

  it("rejects codes whose checksum resolves to 10", () => {
    expect(isValidNip("1234567890")).toBe(false);
  });

  it("rejects wrong lengths and non-digits", () => {
    expect(isValidNip("77400014")).toBe(false);
    expect(isValidNip("77400014AB")).toBe(false);
  });
});

describe("isValidRegon", () => {
  it("accepts a 9-digit REGON", () => {
    expect(isValidRegon(REGON9_ORLEN)).toBe(true);
  });

  it("accepts a 14-digit REGON", () => {
    expect(isValidRegon(REGON14)).toBe(true);
  });

  it("rejects a wrong checksum", () => {
    expect(isValidRegon("610188202")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(isValidRegon("6101882")).toBe(false);
  });
});

describe("classifyPolishIdentifier", () => {
  it("recognises a valid NIP", () => {
    expect(classifyPolishIdentifier(NIP_ORLEN)).toBe("NIP");
  });

  it("recognises a valid REGON", () => {
    expect(classifyPolishIdentifier(REGON9_ORLEN)).toBe("REGON");
    expect(classifyPolishIdentifier(REGON14)).toBe("REGON");
  });

  it("falls back to length when the checksum fails", () => {
    expect(classifyPolishIdentifier(NIP_INVALID_CHECKSUM)).toBe("NIP");
    expect(classifyPolishIdentifier("610188202")).toBe("REGON");
  });

  it("returns UNKNOWN for non-numeric or odd-length input", () => {
    expect(classifyPolishIdentifier("ABC123")).toBe("UNKNOWN");
    expect(classifyPolishIdentifier("1234567")).toBe("UNKNOWN");
  });
});
