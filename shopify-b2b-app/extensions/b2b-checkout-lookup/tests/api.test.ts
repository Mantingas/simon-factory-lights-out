import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_API_BASE_URL, lookupCompany } from "../src/api";

const COMPANY = {
  success: true,
  country: "LT",
  company_code: "305666952",
  vat_code: "LT100013612410",
  name: "Mažoji bendrija Taste lovers",
  address: {
    street: "Perkūnkiemio g. 19",
    city: "Vilnius",
    postal_code: "LT-12120",
    country: "LT",
    full_address: "Vilnius, Perkūnkiemio g. 19, LT-12120",
  },
  is_vat_valid: true,
  source: "LT_JAR",
};

function stubFetch(status: number, body: unknown) {
  const mock = vi.fn(
    async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lookupCompany", () => {
  it("calls the documented path form", async () => {
    const mock = stubFetch(200, COMPANY);
    await lookupCompany("LT", "305666952");

    expect(mock).toHaveBeenCalledWith(
      `${DEFAULT_API_BASE_URL}/api/v1/company/LT/305666952`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses a merchant-configured base URL", async () => {
    const mock = stubFetch(200, COMPANY);
    await lookupCompany("LT", "305666952", { baseUrl: "https://staging.example.com/" });

    expect(mock.mock.calls[0]?.[0]).toBe("https://staging.example.com/api/v1/company/LT/305666952");
  });

  it("returns the company on success", async () => {
    stubFetch(200, COMPANY);
    const outcome = await lookupCompany("LT", "305666952");

    expect(outcome).toEqual({ status: "found", company: COMPANY });
  });

  it.each([
    [404, "notFound"],
    [400, "invalid"],
    [422, "invalid"],
    [429, "rateLimited"],
    [500, "unavailable"],
    [502, "unavailable"],
    [504, "unavailable"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    stubFetch(status, { success: false, error: { code: "X", message: "x" } });
    expect((await lookupCompany("LT", "305666952")).status).toBe(expected);
  });

  it("treats a 200 that is not a company as not found", async () => {
    // Defends against a proxy or captive portal answering 200 with something else.
    stubFetch(200, { hello: "world" });
    expect((await lookupCompany("LT", "305666952")).status).toBe("notFound");
  });

  it("treats a network failure as unavailable, never as not found", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    expect((await lookupCompany("LT", "305666952")).status).toBe("unavailable");
  });

  it("does not report a service outage as the buyer's mistake", async () => {
    stubFetch(503, {});
    const outcome = await lookupCompany("LT", "305666952");
    expect(outcome.status).not.toBe("notFound");
  });

  it("percent-encodes the code, so a stray character cannot alter the path", async () => {
    const mock = stubFetch(404, {});
    await lookupCompany("LT", "305/666" as string);

    expect(mock.mock.calls[0]?.[0]).toContain("305%2F666");
  });
});
