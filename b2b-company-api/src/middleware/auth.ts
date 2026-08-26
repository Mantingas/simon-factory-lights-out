import type { MiddlewareHandler } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";
import { ApiKeyRegistry } from "../auth/api-keys.js";
import { RateLimiter } from "../auth/rate-limiter.js";
import { tierPolicy, type Tier, type TierLimits } from "../auth/tiers.js";

export interface AuthContext {
  tier: Tier;
  /** The quota bucket this request was counted against. */
  identity: string;
  /** Present only for keyed requests, and only as a masked prefix. */
  keyLabel?: string;
}

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthContext;
  }
}

export interface AuthMiddlewareOptions {
  registry?: ApiKeyRegistry;
  limiter?: RateLimiter;
  limits?: TierLimits;
  /**
   * Whether to believe `x-forwarded-for`. Off by default: anonymous quota is
   * metered per IP, and an unconditionally trusted header lets any caller mint
   * a fresh identity per request and bypass the limit entirely.
   */
  trustProxy?: boolean;
}

/** Never log a full key — a prefix is enough to identify it in support. */
export function maskKey(key: string): string {
  if (key.length <= 4) return "****";
  return `${key.slice(0, 4)}${"*".repeat(Math.min(8, key.length - 4))}`;
}

/**
 * Resolves the client IP for anonymous metering. With `trustProxy` on, the
 * left-most `x-forwarded-for` entry is the original client; with it off, only
 * the socket address is used.
 */
export function clientIp(
  forwardedFor: string | undefined,
  remoteAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy && forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  return remoteAddress ?? "unknown";
}

/**
 * API key authentication plus per-tier quota metering.
 *
 * A request may present a key via the `x-api-key` header or an `api_key` query
 * parameter. No key means the `anonymous` tier; an unrecognised key is a 401
 * rather than a silent downgrade, so a customer with a typo'd or revoked key
 * finds out instead of quietly hitting the 20/day anonymous cap.
 */
export function apiKeyAuth(options: AuthMiddlewareOptions = {}): MiddlewareHandler {
  const registry = options.registry ?? ApiKeyRegistry.fromEnv(config.API_KEYS);
  const limiter = options.limiter ?? new RateLimiter();
  const trustProxy = options.trustProxy ?? config.TRUST_PROXY;
  const limits: TierLimits = options.limits ?? {
    anonymousDaily: config.ANONYMOUS_DAILY_LIMIT,
    starterMonthly: config.STARTER_MONTHLY_LIMIT,
    proMonthly: config.PRO_MONTHLY_LIMIT,
  };

  return async (c, next) => {
    const presentedKey = (c.req.header("x-api-key") ?? c.req.query("api_key"))?.trim();

    let tier: Tier = "anonymous";
    let identity: string;
    let keyLabel: string | undefined;

    if (presentedKey) {
      const record = registry.resolve(presentedKey);
      if (!record) {
        logger.warn("rejected unknown API key", { key: maskKey(presentedKey) });
        throw ApiError.unauthorized("The supplied API key is not valid.");
      }
      tier = record.tier;
      identity = `key:${presentedKey}`;
      keyLabel = maskKey(presentedKey);
    } else {
      let remoteAddress: string | undefined;
      try {
        remoteAddress = getConnInfo(c).remote.address;
      } catch {
        // No Node socket behind this request (e.g. `app.request()` in tests).
        remoteAddress = undefined;
      }
      identity = `ip:${clientIp(c.req.header("x-forwarded-for"), remoteAddress, trustProxy)}`;
    }

    const policy = tierPolicy(tier, limits);
    const decision = limiter.consume(identity, policy);

    c.header("x-ratelimit-limit", decision.limit === null ? "unlimited" : String(decision.limit));
    c.header(
      "x-ratelimit-remaining",
      decision.remaining === null ? "unlimited" : String(decision.remaining),
    );
    c.header("x-ratelimit-reset", String(Math.floor(decision.resetAt / 1000)));

    if (!decision.allowed) {
      c.header("retry-after", String(decision.retryAfterSeconds));
      logger.info("rate limit exceeded", { tier, identity: keyLabel ?? identity });
      throw ApiError.rateLimited(
        tier === "anonymous"
          ? `Anonymous quota of ${decision.limit} requests per 24 hours exhausted. Supply an API key via the 'x-api-key' header for a higher limit.`
          : `Monthly quota of ${decision.limit} requests for the '${tier}' plan exhausted.`,
        {
          tier,
          limit: decision.limit,
          reset_at: new Date(decision.resetAt).toISOString(),
          retry_after_seconds: decision.retryAfterSeconds,
        },
      );
    }

    c.set("auth", { tier, identity, ...(keyLabel ? { keyLabel } : {}) });
    await next();
  };
}
