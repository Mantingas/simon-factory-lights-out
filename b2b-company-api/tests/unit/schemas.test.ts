import { describe, expect, it } from "vitest";
import { companyQuerySchema, toLookupInput } from "../../src/schemas.js";
import { NIP_ORLEN } from "../helpers/fixtures.js";

const parse = (input: unknown) => companyQuerySchema.safeParse(input);

describe("companyQuerySchema", () => {
  it("accepts a well-formed query and upper-cases the country", () => {
    const result = parse({ country: " lt ", code: "100001919817" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.country).toBe("LT");
  });

  it.each([
    ["a missing country", { code: "100001919817" }],
    ["a 3-letter country", { country: "LTU", code: "100001919817" }],
    ["a numeric country", { country: "12", code: "100001919817" }],
    ["a missing code", { country: "LT" }],
    ["an empty code", { country: "LT", code: "  " }],
    ["a too-short code", { country: "LT", code: "12" }],
    ["a code with illegal characters", { country: "LT", code: "abc$%^123" }],
    ["an over-long code", { country: "LT", code: "1".repeat(33) }],
  ])("rejects %s", (_label, input) => {
    expect(parse(input).success).toBe(false);
  });

  it("accepts codes written with separators", () => {
    expect(parse({ country: "PL", code: "774-000-14-54" }).success).toBe(true);
  });
});

describe("toLookupInput", () => {
  it("normalizes a plain registration code", () => {
    expect(toLookupInput({ country: "PL", code: "774-000-14-54" })).toEqual({
      country: "PL",
      code: NIP_ORLEN,
      rawCode: "774-000-14-54",
      vatPrefixed: false,
    });
  });

  it("strips the VAT prefix and records that one was supplied", () => {
    expect(toLookupInput({ country: "LT", code: "LT100001919817" })).toEqual({
      country: "LT",
      code: "100001919817",
      rawCode: "LT100001919817",
      vatPrefixed: true,
    });
  });

  it("does not treat an unknown prefix as a VAT prefix", () => {
    expect(toLookupInput({ country: "LT", code: "AB100001" })).toMatchObject({
      code: "AB100001",
      vatPrefixed: false,
    });
  });
});
