import type { QuotaWindow, TierPolicy } from "./tiers.js";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number | null;
  remaining: number | null;
  /** Epoch milliseconds at which the current window resets. */
  resetAt: number;
  /** Seconds until reset, for the `Retry-After` header. */
  retryAfterSeconds: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

export interface RateLimiterOptions {
  /** Injectable clock so quota windows can be tested without waiting. */
  now?: () => number;
  /** Entries idle past their reset are swept at this interval. */
  sweepIntervalMs?: number;
  maxEntries?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the next UTC calendar month — how monthly plans are billed. */
export function nextMonthStart(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0);
}

export function windowResetAt(window: QuotaWindow, nowMs: number): number {
  return window === "daily" ? nowMs + DAY_MS : nextMonthStart(nowMs);
}

/**
 * In-memory fixed-window counter.
 *
 * Single-process only: each instance meters its own traffic, so a horizontally
 * scaled deployment needs a shared store (Redis) behind this same interface.
 * That is a deliberate trade for now — it keeps the service dependency-free.
 */
export class RateLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: RateLimiterOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.maxEntries = options.maxEntries ?? 100_000;

    const interval = options.sweepIntervalMs ?? 10 * 60 * 1000;
    if (interval > 0) {
      this.sweepTimer = setInterval(() => this.sweep(), interval);
      // Never hold the process open just to expire counters.
      this.sweepTimer.unref?.();
    }
  }

  /** Records one request against `identity` and reports whether it is allowed. */
  consume(identity: string, policy: TierPolicy): RateLimitDecision {
    const nowMs = this.now();

    if (policy.limit === null) {
      return {
        allowed: true,
        limit: null,
        remaining: null,
        resetAt: windowResetAt(policy.window, nowMs),
        retryAfterSeconds: 0,
      };
    }

    let counter = this.counters.get(identity);
    if (!counter || nowMs >= counter.resetAt) {
      counter = { count: 0, resetAt: windowResetAt(policy.window, nowMs) };
      this.counters.set(identity, counter);
    }

    const retryAfterSeconds = Math.max(1, Math.ceil((counter.resetAt - nowMs) / 1000));

    if (counter.count >= policy.limit) {
      return {
        allowed: false,
        limit: policy.limit,
        remaining: 0,
        resetAt: counter.resetAt,
        retryAfterSeconds,
      };
    }

    counter.count += 1;
    if (this.counters.size > this.maxEntries) this.sweep();

    return {
      allowed: true,
      limit: policy.limit,
      remaining: policy.limit - counter.count,
      resetAt: counter.resetAt,
      retryAfterSeconds,
    };
  }

  /** Current usage without recording a request. */
  peek(identity: string): Counter | undefined {
    const counter = this.counters.get(identity);
    if (!counter) return undefined;
    if (this.now() >= counter.resetAt) return undefined;
    return { ...counter };
  }

  reset(identity?: string): void {
    if (identity === undefined) this.counters.clear();
    else this.counters.delete(identity);
  }

  get size(): number {
    return this.counters.size;
  }

  /** Drops counters whose window has already closed. */
  sweep(): number {
    const nowMs = this.now();
    let removed = 0;
    for (const [identity, counter] of this.counters) {
      if (nowMs >= counter.resetAt) {
        this.counters.delete(identity);
        removed += 1;
      }
    }
    return removed;
  }

  /** Stops the sweep timer; used by tests and graceful shutdown. */
  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
  }
}
