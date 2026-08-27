import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const lt = JSON.parse(
  readFileSync(new URL("../locales/lt.default.json", import.meta.url), "utf8"),
) as Record<string, string>;
const en = JSON.parse(
  readFileSync(new URL("../locales/en.json", import.meta.url), "utf8"),
) as Record<string, string>;
const component = readFileSync(new URL("../src/Checkout.tsx", import.meta.url), "utf8");

/**
 * Keys the component asks for. The country list is built from a template
 * literal, so those four are added explicitly — they are the only dynamic keys.
 */
function usedKeys(): string[] {
  const literal = [...component.matchAll(/translate\(\s*"([^"]+)"/g)].map((match) => match[1] as string);
  const dynamic = ["country.LT", "country.PL", "country.LV", "country.EE"];
  return [...new Set([...literal, ...dynamic])];
}

describe("locales", () => {
  it("define the same keys in both languages", () => {
    expect(Object.keys(lt).sort()).toEqual(Object.keys(en).sort());
  });

  it("cover every key the component asks for", () => {
    // A missing key renders as the raw key in checkout — visible to the buyer,
    // and exactly the kind of thing that ships unnoticed.
    const missing = usedKeys().filter((key) => !(key in lt));
    expect(missing).toEqual([]);
  });

  it("do not carry keys the component never asks for", () => {
    const used = usedKeys();
    expect(Object.keys(lt).filter((key) => !used.includes(key))).toEqual([]);
  });

  it("have no empty translations", () => {
    for (const [key, value] of Object.entries({ ...lt, ...en })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("use the same placeholders in both languages", () => {
    const placeholders = (value: string) =>
      [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort();

    for (const key of Object.keys(lt)) {
      expect(placeholders(lt[key] as string), key).toEqual(placeholders(en[key] as string));
    }
  });

  it("tell the buyer what to do instead, on every failure", () => {
    // The point of these messages is the next step, not the diagnosis.
    for (const key of ["notFound.body", "rateLimited.body", "unavailable.body"]) {
      expect(lt[key], key).toContain("rankiniu būdu");
      expect(en[key], key).toContain("manually");
    }
  });
});
