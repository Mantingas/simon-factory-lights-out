import { afterEach, describe, expect, it } from "vitest";
import { RateLimiter, nextMonthStart, windowResetAt } from "../../src/auth/rate-limiter.js";
import { tierPolicy } from "../../src/auth/tiers.js";

const LIMITS = { anonymousDaily: 3, starterMonthly: 5, proMonthly: 10 };
const DAY_MS = 24 * 60 * 60 * 1000;
const JAN_15 = Date.UTC(2026, 0, 15, 12, 0, 0);

const limiters: RateLimiter[] = [];

function build(startMs = JAN_15) {
  let now = startMs;
  const limiter = new RateLimiter({ now: () => now, sweepIntervalMs: 0 });
  limiters.push(limiter);
  return { limiter, advance: (ms: number) => (now += ms), at: () => now };
}

afterEach(() => {
  for (const limiter of limiters.splice(0)) limiter.stop();
});

describe("window boundaries", () => {
  it("rolls a daily window 24h forward", () => {
    expect(windowResetAt("daily", JAN_15)).toBe(JAN_15 + DAY_MS);
  });

  it("resets a monthly window at the start of the next UTC month", () => {
    expect(nextMonthStart(JAN_15)).toBe(Date.UTC(2026, 1, 1));
  });

  it("rolls a December window into the next year", () => {
    expect(nextMonthStart(Date.UTC(2026, 11, 31, 23, 59))).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("RateLimiter — anonymous daily quota", () => {
  const policy = tierPolicy("anonymous", LIMITS);

  it("allows exactly `limit` requests and counts down remaining", () => {
    const { limiter } = build();
    expect(limiter.consume("ip:1.2.3.4", policy)).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume("ip:1.2.3.4", policy)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("ip:1.2.3.4", policy)).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("blocks the request after the quota is spent", () => {
    const { limiter } = build();
    for (let i = 0; i < 3; i++) limiter.consume("ip:1.2.3.4", policy);

    const decision = limiter.consume("ip:1.2.3.4", policy);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBe(DAY_MS / 1000);
  });

  it("meters each identity separately", () => {
    const { limiter } = build();
    for (let i = 0; i < 3; i++) limiter.consume("ip:1.1.1.1", policy);

    expect(limiter.consume("ip:1.1.1.1", policy).allowed).toBe(false);
    expect(limiter.consume("ip:2.2.2.2", policy).allowed).toBe(true);
  });

  it("refills once 24 hours have passed", () => {
    const { limiter, advance } = build();
    for (let i = 0; i < 3; i++) limiter.consume("ip:1.2.3.4", policy);
    expect(limiter.consume("ip:1.2.3.4", policy).allowed).toBe(false);

    advance(DAY_MS - 1);
    expect(limiter.consume("ip:1.2.3.4", policy).allowed).toBe(false);

    advance(2);
    expect(limiter.consume("ip:1.2.3.4", policy)).toMatchObject({ allowed: true, remaining: 2 });
  });

  it("shrinks retry-after as the window elapses", () => {
    const { limiter, advance } = build();
    for (let i = 0; i < 3; i++) limiter.consume("ip:1.2.3.4", policy);
    advance(DAY_MS / 2);

    expect(limiter.consume("ip:1.2.3.4", policy).retryAfterSeconds).toBe(DAY_MS / 2000);
  });
});

describe("RateLimiter — monthly quotas", () => {
  it("blocks a starter key past its monthly allowance", () => {
    const { limiter } = build();
    const policy = tierPolicy("starter", LIMITS);
    for (let i = 0; i < 5; i++) expect(limiter.consume("key:k1", policy).allowed).toBe(true);
    expect(limiter.consume("key:k1", policy).allowed).toBe(false);
  });

  it("gives a pro key a larger allowance on the same window", () => {
    const { limiter } = build();
    const pro = tierPolicy("pro", LIMITS);
    for (let i = 0; i < 10; i++) expect(limiter.consume("key:k2", pro).allowed).toBe(true);
    expect(limiter.consume("key:k2", pro)).toMatchObject({
      allowed: false,
      limit: 10,
      resetAt: Date.UTC(2026, 1, 1),
    });
  });

  it("refills at the start of the next calendar month", () => {
    const { limiter, advance } = build();
    const policy = tierPolicy("starter", LIMITS);
    for (let i = 0; i < 5; i++) limiter.consume("key:k1", policy);
    expect(limiter.consume("key:k1", policy).allowed).toBe(false);

    advance(Date.UTC(2026, 1, 1) - JAN_15);
    expect(limiter.consume("key:k1", policy)).toMatchObject({ allowed: true, remaining: 4 });
  });
});

describe("RateLimiter — unlimited tier", () => {
  it("never blocks and never reports a remaining count", () => {
    const { limiter } = build();
    const policy = tierPolicy("unlimited", LIMITS);

    for (let i = 0; i < 500; i++) {
      expect(limiter.consume("key:vip", policy)).toMatchObject({
        allowed: true,
        limit: null,
        remaining: null,
      });
    }
    // Unlimited callers are not tracked, so they cost no memory.
    expect(limiter.size).toBe(0);
  });
});

describe("RateLimiter — bookkeeping", () => {
  it("peeks without consuming", () => {
    const { limiter } = build();
    const policy = tierPolicy("anonymous", LIMITS);
    limiter.consume("ip:1.2.3.4", policy);

    expect(limiter.peek("ip:1.2.3.4")?.count).toBe(1);
    expect(limiter.peek("ip:1.2.3.4")?.count).toBe(1);
    expect(limiter.peek("ip:9.9.9.9")).toBeUndefined();
  });

  it("treats an elapsed window as absent when peeking", () => {
    const { limiter, advance } = build();
    limiter.consume("ip:1.2.3.4", tierPolicy("anonymous", LIMITS));
    advance(DAY_MS + 1);
    expect(limiter.peek("ip:1.2.3.4")).toBeUndefined();
  });

  it("sweeps expired counters", () => {
    const { limiter, advance } = build();
    const policy = tierPolicy("anonymous", LIMITS);
    limiter.consume("ip:1.1.1.1", policy);
    limiter.consume("ip:2.2.2.2", policy);
    expect(limiter.size).toBe(2);

    advance(DAY_MS + 1);
    expect(limiter.sweep()).toBe(2);
    expect(limiter.size).toBe(0);
  });

  it("resets one identity or all of them", () => {
    const { limiter } = build();
    const policy = tierPolicy("anonymous", LIMITS);
    limiter.consume("ip:1.1.1.1", policy);
    limiter.consume("ip:2.2.2.2", policy);

    limiter.reset("ip:1.1.1.1");
    expect(limiter.size).toBe(1);
    limiter.reset();
    expect(limiter.size).toBe(0);
  });
});
