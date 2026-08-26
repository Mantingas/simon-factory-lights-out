import { logger } from "../utils/logger.js";
import { isTier, type Tier } from "./tiers.js";

export interface ApiKeyRecord {
  key: string;
  tier: Tier;
  /** Optional owner label, surfaced in logs rather than in responses. */
  label?: string;
}

/**
 * Parses the `API_KEYS` environment variable.
 *
 * Two accepted forms:
 *   API_KEYS=key-abc:starter,key-def:pro,key-xyz:unlimited
 *   API_KEYS=[{"key":"key-abc","tier":"starter","label":"Acme"}]
 *
 * Malformed entries are logged and skipped rather than crashing boot: losing
 * one customer's key should not take the whole service down.
 */
export function parseApiKeys(raw: string | undefined): ApiKeyRecord[] {
  const value = raw?.trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("expected a JSON array");
      return parsed.flatMap((entry) => {
        const record = entry as Partial<ApiKeyRecord>;
        if (typeof record.key !== "string" || !record.key.trim()) return [];
        if (typeof record.tier !== "string" || !isTier(record.tier)) {
          logger.warn("ignoring API key with an unknown tier", { tier: record.tier });
          return [];
        }
        return [
          {
            key: record.key.trim(),
            tier: record.tier,
            ...(record.label ? { label: record.label } : {}),
          },
        ];
      });
    } catch (error) {
      logger.error("API_KEYS is not valid JSON — starting with no keys", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  return value.split(",").flatMap((pair) => {
    const trimmed = pair.trim();
    if (!trimmed) return [];
    const separator = trimmed.lastIndexOf(":");
    if (separator <= 0) {
      logger.warn("ignoring malformed API_KEYS entry — expected `key:tier`");
      return [];
    }
    const key = trimmed.slice(0, separator).trim();
    const tier = trimmed.slice(separator + 1).trim();
    if (!key || !isTier(tier)) {
      logger.warn("ignoring API key with an unknown tier", { tier });
      return [];
    }
    return [{ key, tier }];
  });
}

/** Constant-time-ish lookup table of issued keys. */
export class ApiKeyRegistry {
  private readonly keys: Map<string, ApiKeyRecord>;

  constructor(records: ApiKeyRecord[] = []) {
    this.keys = new Map(records.map((record) => [record.key, record]));
  }

  static fromEnv(raw: string | undefined): ApiKeyRegistry {
    return new ApiKeyRegistry(parseApiKeys(raw));
  }

  get size(): number {
    return this.keys.size;
  }

  /** `undefined` means the key was presented but is not issued. */
  resolve(key: string): ApiKeyRecord | undefined {
    return this.keys.get(key);
  }
}
