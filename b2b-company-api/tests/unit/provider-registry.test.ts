import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "../../src/providers/index.js";
import { companyFor, stubProvider } from "../helpers/stub-provider.js";
import { NIP_ORLEN, REGON9_ORLEN, lookupInput } from "../helpers/fixtures.js";

function registry() {
  const gus = stubProvider("GUS_BIR", (input) => companyFor(input, "GUS_BIR"));
  const vies = stubProvider("VIES", (input) => companyFor(input, "VIES"));
  return { registry: new ProviderRegistry({ gus, vies }), gus, vies };
}

const names = (input: Parameters<ProviderRegistry["resolve"]>[0]) =>
  registry().registry.resolve(input).map((provider) => provider.name);

describe("ProviderRegistry.resolve", () => {
  it("routes a Polish NIP to GUS first, with VIES as a fallback", () => {
    expect(names(lookupInput({ country: "PL", code: NIP_ORLEN, rawCode: NIP_ORLEN }))).toEqual([
      "GUS_BIR",
      "VIES",
    ]);
  });

  it("routes a Polish REGON to GUS only — VIES cannot answer a REGON", () => {
    expect(names(lookupInput({ country: "PL", code: REGON9_ORLEN, rawCode: REGON9_ORLEN }))).toEqual([
      "GUS_BIR",
    ]);
  });

  it("routes a VAT-prefixed Polish code to VIES first", () => {
    expect(
      names(
        lookupInput({
          country: "PL",
          code: NIP_ORLEN,
          rawCode: `PL${NIP_ORLEN}`,
          vatPrefixed: true,
        }),
      ),
    ).toEqual(["VIES", "GUS_BIR"]);
  });

  it.each(["LT", "LV", "EE", "DE", "FR", "GR"])("routes %s to VIES", (country) => {
    expect(names(lookupInput({ country }))).toEqual(["VIES"]);
  });

  it("rejects a country no provider covers", () => {
    expect(() => names(lookupInput({ country: "US" }))).toThrowError(
      /No provider is configured for country 'US'/,
    );
  });

  it("builds the real adapters when none are injected", () => {
    const chain = new ProviderRegistry().resolve(lookupInput({ country: "LT" }));
    expect(chain.map((provider) => provider.name)).toEqual(["VIES"]);
  });
});
