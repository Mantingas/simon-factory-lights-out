import { describe, expect, it } from "vitest";
import { asArray, escapeXml, parseXml, pick, text } from "../../src/utils/xml.js";

describe("parseXml + pick", () => {
  it("resolves a namespaced path with prefixes removed", () => {
    const parsed = parseXml(
      `<s:Envelope xmlns:s="x"><s:Body><Result>abc</Result></s:Body></s:Envelope>`,
    );
    expect(pick(parsed, "Envelope", "Body", "Result")).toBe("abc");
  });

  it("returns undefined for a missing hop", () => {
    const parsed = parseXml("<root><a>1</a></root>");
    expect(pick(parsed, "root", "missing", "deeper")).toBeUndefined();
  });

  it("descends into the first element of a repeated node", () => {
    const parsed = parseXml("<root><dane><Nip>1</Nip></dane><dane><Nip>2</Nip></dane></root>");
    expect(pick(parsed, "root", "dane", "Nip")).toBe("1");
  });

  it("keeps leading zeros in codes", () => {
    const parsed = parseXml("<root><KodPocztowy>09411</KodPocztowy></root>");
    expect(pick(parsed, "root", "KodPocztowy")).toBe("09411");
  });
});

describe("text", () => {
  it("trims and returns strings", () => {
    expect(text("  hello  ")).toBe("hello");
  });

  it("returns undefined for empty, null and object values", () => {
    expect(text("   ")).toBeUndefined();
    expect(text(null)).toBeUndefined();
    expect(text(undefined)).toBeUndefined();
    expect(text({})).toBeUndefined();
  });

  it("unwraps single-element arrays", () => {
    expect(text(["a", "b"])).toBe("a");
  });
});

describe("asArray", () => {
  it("wraps scalars and passes arrays through", () => {
    expect(asArray("a")).toEqual(["a"]);
    expect(asArray(["a", "b"])).toEqual(["a", "b"]);
    expect(asArray(undefined)).toEqual([]);
  });
});

describe("escapeXml", () => {
  it("escapes the five XML entities", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });
});
