import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  // Everything the SOAP upstream returns is a code or a name; keeping values as
  // strings stops leading zeros in REGON/postal codes from being eaten.
  numberParseOptions: { hex: false, leadingZeros: false, eNotation: false },
  removeNSPrefix: true,
});

export function parseXml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/**
 * Walks a parsed XML object by tag names, tolerating the arrays fast-xml-parser
 * produces for repeated elements. Returns `undefined` when any hop is missing.
 */
export function pick(node: unknown, ...path: string[]): unknown {
  let current: unknown = node;
  for (const key of path) {
    if (Array.isArray(current)) current = current[0];
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Coerces a parsed XML leaf to a trimmed string, or `undefined` when empty. */
export function text(value: unknown): string | undefined {
  if (Array.isArray(value)) return text(value[0]);
  if (value === null || value === undefined) return undefined;
  if (typeof value === "object") return undefined;
  const str = String(value).trim();
  return str.length > 0 ? str : undefined;
}

/** Returns repeated XML children as an array regardless of arity. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

const XML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char] ?? char);
}
