import { describe, expect, it } from "vitest";
import { GusProvider } from "../../src/providers/gus.provider.js";
import { ViesProvider } from "../../src/providers/vies.provider.js";
import { NIP_ORLEN } from "../helpers/fixtures.js";

/**
 * Contract tests against the real upstreams. They are opt-in because they need
 * outbound network access to `ec.europa.eu` and `stat.gov.pl`, and because both
 * services have rate limits and occasional member-state outages that would make
 * CI flaky.
 *
 *   RUN_LIVE_TESTS=1 npm run test:integration
 */
const live = process.env.RUN_LIVE_TESTS === "1" ? describe : describe.skip;

live("live upstreams", () => {
  it(
    "resolves a Polish company through the GUS BIR test endpoint",
    { timeout: 30_000 },
    async () => {
      const result = await new GusProvider().lookup({
        country: "PL",
        code: NIP_ORLEN,
        rawCode: NIP_ORLEN,
        vatPrefixed: false,
      });

      expect(result.success).toBe(true);
      expect(result.source).toBe("GUS_BIR");
      expect(result.name.length).toBeGreaterThan(0);
      expect(result.address.country).toBe("PL");
    },
  );

  it("validates a Lithuanian VAT number through VIES", { timeout: 30_000 }, async () => {
    const result = await new ViesProvider().lookup({
      country: "LT",
      code: "100001919817",
      rawCode: "LT100001919817",
      vatPrefixed: true,
    });

    expect(result.success).toBe(true);
    expect(result.source).toBe("VIES");
    expect(result.is_vat_valid).toBe(true);
    expect(result.vat_code).toBe("LT100001919817");
  });
});
