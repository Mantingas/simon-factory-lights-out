/** Billing tiers, in ascending order of entitlement. */
export const TIERS = ["anonymous", "starter", "pro", "unlimited"] as const;
export type Tier = (typeof TIERS)[number];

export type QuotaWindow = "daily" | "monthly";

export interface TierPolicy {
  tier: Tier;
  /** Maximum requests per window, or `null` for no limit. */
  limit: number | null;
  window: QuotaWindow;
}

export function isTier(value: string): value is Tier {
  return (TIERS as readonly string[]).includes(value);
}

export interface TierLimits {
  anonymousDaily: number;
  starterMonthly: number;
  proMonthly: number;
}

/**
 * `anonymous` is metered per IP over a rolling 24 hours so the API stays
 * explorable without a key; paid tiers are metered per key over a calendar
 * month, which is how they are billed.
 */
export function tierPolicy(tier: Tier, limits: TierLimits): TierPolicy {
  switch (tier) {
    case "anonymous":
      return { tier, limit: limits.anonymousDaily, window: "daily" };
    case "starter":
      return { tier, limit: limits.starterMonthly, window: "monthly" };
    case "pro":
      return { tier, limit: limits.proMonthly, window: "monthly" };
    case "unlimited":
      return { tier, limit: null, window: "monthly" };
  }
}
