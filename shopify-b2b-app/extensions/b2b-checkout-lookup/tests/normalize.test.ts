import { describe, expect, it } from "vitest";
import {
  defaultCountry,
  isSupportedCountry,
  looksSearchable,
  normalizeCompanyCode,
} from "../src/normalize";

describe("normalizeCompanyCode", () => {
  it("leaves a clean company code alone", () => {
    expect(normalizeCompanyCode("305666952")).toEqual({ code: "305666952" });
  });

  it.each([
    ["305 666 952", "305666952"],
    ["305-666-952", "305666952"],
    ["305.666.952", "305666952"],
    ["  305666952  ", "305666952"],
    ["305/666/952", "305666952"],
  ])("strips separators from %s", (input, expected) => {
    expect(normalizeCompanyCode(input).code).toBe(expected);
  });

  it("strips a non-breaking space, which pasting from a PDF often brings", () => {
    expect(normalizeCompanyCode("305 666 952").code).toBe("305666952");
  });

  it.each([
    ["LT100013612410", "100013612410", "LT"],
    ["lt100013612410", "100013612410", "LT"],
    ["PL7740001454", "7740001454", "PL"],
    ["LV40003009497", "40003009497", "LV"],
    ["EE100931558", "100931558", "EE"],
  ])("strips the VAT prefix from %s", (input, code, prefix) => {
    expect(normalizeCompanyCode(input)).toEqual({ code, strippedPrefix: prefix });
  });

  it("strips a prefix even when the number was pasted with spaces", () => {
    expect(normalizeCompanyCode("LT 100 013 612 410")).toEqual({
      code: "100013612410",
      strippedPrefix: "LT",
    });
  });

  it("does not strip a prefix that is the whole input", () => {
    // Otherwise the field appears to swallow what was just typed.
    expect(normalizeCompanyCode("LT")).toEqual({ code: "LT" });
  });

  it("does not strip letters that are not an EU VAT prefix", () => {
    expect(normalizeCompanyCode("AB123456789")).toEqual({ code: "AB123456789" });
  });

  it("drops Lithuanian letters typed by accident rather than mangling them", () => {
    expect(normalizeCompanyCode("305ą666š952").code).toBe("305666952");
  });

  it("returns an empty code for input with nothing usable", () => {
    expect(normalizeCompanyCode("   ---   ").code).toBe("");
    expect(normalizeCompanyCode("").code).toBe("");
  });
});

describe("looksSearchable", () => {
  it.each(["305666952", "100013612410", "7740001454", "40003009497"])(
    "accepts %s",
    (code) => {
      expect(looksSearchable(code)).toBe(true);
    },
  );

  it("rejects input too short to be any company code", () => {
    expect(looksSearchable("")).toBe(false);
    expect(looksSearchable("30566")).toBe(false);
  });

  it("rejects input too long to be one", () => {
    expect(looksSearchable("1".repeat(21))).toBe(false);
  });
});

describe("defaultCountry", () => {
  it.each(["LT", "PL", "LV", "EE"])("keeps the checkout country %s", (code) => {
    expect(defaultCountry(code)).toBe(code);
  });

  it("accepts a lowercase country code", () => {
    expect(defaultCountry("pl")).toBe("PL");
  });

  it("falls back to Lithuania for a country the extension does not serve", () => {
    expect(defaultCountry("DE")).toBe("LT");
    expect(defaultCountry("US")).toBe("LT");
  });

  it("falls back to Lithuania when checkout has no country yet", () => {
    expect(defaultCountry(undefined)).toBe("LT");
    expect(defaultCountry("")).toBe("LT");
  });
});

describe("isSupportedCountry", () => {
  it("narrows only the four served countries", () => {
    expect(isSupportedCountry("LT")).toBe(true);
    expect(isSupportedCountry("DE")).toBe(false);
    expect(isSupportedCountry(undefined)).toBe(false);
  });
});
