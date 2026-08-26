import { afterEach, describe, expect, it } from "vitest";
import {
  GusProvider,
  formatPolishPostalCode,
  formatPolishStreet,
  parseGusSearchResult,
} from "../../src/providers/gus.provider.js";
import { stubFetch, type FetchStub } from "../helpers/fetch-mock.js";
import {
  GUS_LOGIN_REJECTED,
  GUS_LOGIN_RESPONSE,
  GUS_LOGOUT_RESPONSE,
  GUS_SEARCH_FOUND,
  GUS_SEARCH_NOT_FOUND,
  NIP_ORLEN,
  REGON9_ORLEN,
  lookupInput,
} from "../helpers/fixtures.js";

const BASE_URL = "https://gus.test/wsBIR/UslugaBIRzewnPubl.svc";
const provider = new GusProvider({ baseUrl: BASE_URL, userKey: "test-key-1234567890" });

const soap = (body: string) => ({ status: 200, body, headers: { "content-type": "application/soap+xml" } });

const plInput = (code: string) =>
  lookupInput({ country: "PL", code, rawCode: code, vatPrefixed: false });

let stub: FetchStub | undefined;
afterEach(() => {
  stub?.restore();
  stub = undefined;
});

describe("formatPolishPostalCode", () => {
  it("inserts the dash into a bare 5-digit code", () => {
    expect(formatPolishPostalCode("09411")).toBe("09-411");
  });

  it("leaves an already formatted or unexpected code alone", () => {
    expect(formatPolishPostalCode("09-411")).toBe("09-411");
    expect(formatPolishPostalCode("1234")).toBe("1234");
    expect(formatPolishPostalCode(undefined)).toBeUndefined();
  });
});

describe("formatPolishStreet", () => {
  it("joins street and building number", () => {
    expect(formatPolishStreet({ street: "ul. Chemików", buildingNumber: "7" })).toBe("ul. Chemików 7");
  });

  it("appends the flat number after a slash", () => {
    expect(
      formatPolishStreet({ street: "ul. Prosta", buildingNumber: "12", flatNumber: "3" }),
    ).toBe("ul. Prosta 12/3");
  });

  it("returns undefined when there is nothing to join", () => {
    expect(formatPolishStreet({})).toBeUndefined();
  });
});

describe("parseGusSearchResult", () => {
  it("extracts a record from the nested XML payload", () => {
    const inner = GUS_SEARCH_FOUND.match(/<DaneSzukajPodmiotyResult>([\s\S]*)<\/DaneSzukajPodmiotyResult>/)?.[1];
    const decoded = (inner ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const [entity] = parseGusSearchResult(decoded);

    expect(entity).toMatchObject({
      regon: REGON9_ORLEN,
      nip: NIP_ORLEN,
      name: "ORLEN SPÓŁKA AKCYJNA",
      postalCode: "09411",
      city: "Płock",
    });
  });

  it("returns nothing for a not-found error code", () => {
    expect(parseGusSearchResult("<root><dane><ErrorCode>4</ErrorCode></dane></root>")).toEqual([]);
  });

  it("returns nothing for an empty payload", () => {
    expect(parseGusSearchResult("   ")).toEqual([]);
  });
});

describe("GusProvider.supports", () => {
  it("only claims Poland", () => {
    expect(provider.supports(plInput(NIP_ORLEN))).toBe(true);
    expect(provider.supports(lookupInput({ country: "LT" }))).toBe(false);
  });
});

describe("GusProvider.lookup", () => {
  it("runs the full Zaloguj -> DaneSzukajPodmioty -> Wyloguj cycle", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(NIP_ORLEN));

    expect(stub.calls).toHaveLength(3);
    expect(stub.calls.map((call) => call.url)).toEqual([BASE_URL, BASE_URL, BASE_URL]);
    expect(stub.calls.every((call) => call.method === "POST")).toBe(true);
    expect(stub.calls[0]?.body).toContain("<ns:Zaloguj>");
    expect(stub.calls[1]?.body).toContain("<ns:DaneSzukajPodmioty>");
    expect(stub.calls[2]?.body).toContain("<ns:Wyloguj>");
  });

  it("sends SOAP 1.2 with the WS-Addressing action each operation expects", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(NIP_ORLEN));

    for (const call of stub.calls) {
      expect(call.headers["content-type"]).toBe("application/soap+xml;charset=UTF-8");
      expect(call.body).toContain(`<wsa:To>${BASE_URL}</wsa:To>`);
    }
    expect(stub.calls[0]?.body).toContain(
      "<wsa:Action>http://CIS/BIR/2014/07/IUslugaBIRzewnPubl/Zaloguj</wsa:Action>",
    );
    expect(stub.calls[1]?.body).toContain(
      "<wsa:Action>http://CIS/BIR/PublDane/2021/11/IUslugaBIRzewnPubl/DaneSzukajPodmioty</wsa:Action>",
    );
    expect(stub.calls[2]?.body).toContain(
      "<wsa:Action>http://CIS/BIR/2014/07/IUslugaBIRzewnPubl/Wyloguj</wsa:Action>",
    );
  });

  it("carries the session id in the sid header on search and logout", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(NIP_ORLEN));

    expect(stub.calls[0]?.headers["sid"]).toBeUndefined();
    expect(stub.calls[1]?.headers["sid"]).toBe("session-abc-123");
    expect(stub.calls[2]?.headers["sid"]).toBe("session-abc-123");
    expect(stub.calls[2]?.body).toContain("<ns:pIdentyfikatorSesji>session-abc-123");
  });

  it("searches by Nip for a 10-digit NIP", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(NIP_ORLEN));
    expect(stub.calls[1]?.body).toContain(`<dat:Nip xmlns:dat="http://CIS/BIR/PublDane/2021/11/DataContract">${NIP_ORLEN}</dat:Nip>`);
  });

  it("searches by Regon for a 9-digit REGON", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(REGON9_ORLEN));
    expect(stub.calls[1]?.body).toContain(`>${REGON9_ORLEN}</dat:Regon>`);
  });

  it("maps the GUS record onto the normalized schema", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    const result = await provider.lookup(plInput(NIP_ORLEN));

    expect(result).toEqual({
      success: true,
      country: "PL",
      company_code: REGON9_ORLEN,
      vat_code: `PL${NIP_ORLEN}`,
      name: "ORLEN SPÓŁKA AKCYJNA",
      address: {
        street: "ul. Chemików 7",
        city: "Płock",
        postal_code: "09-411",
        country: "PL",
        full_address: "ul. Chemików 7, 09-411 Płock, Poland",
      },
      // GUS is the REGON register; VAT status has to come from VIES.
      is_vat_valid: false,
      source: "GUS_BIR",
    });
  });

  it("rejects a code that is neither a NIP nor a REGON before opening a session", async () => {
    stub = stubFetch([]);
    await expect(provider.lookup(plInput("12345"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    expect(stub.calls).toHaveLength(0);
  });

  it("raises NOT_FOUND when GUS reports no matching entity", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_NOT_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await expect(provider.lookup(plInput(NIP_ORLEN))).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("still logs out when the search finds nothing", async () => {
    stub = stubFetch([soap(GUS_LOGIN_RESPONSE), soap(GUS_SEARCH_NOT_FOUND), soap(GUS_LOGOUT_RESPONSE)]);
    await provider.lookup(plInput(NIP_ORLEN)).catch(() => undefined);
    expect(stub.calls[2]?.body).toContain("<ns:Wyloguj>");
  });

  it("reports a rejected user key as an upstream error", async () => {
    stub = stubFetch([soap(GUS_LOGIN_REJECTED)]);
    await expect(provider.lookup(plInput(NIP_ORLEN))).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      status: 502,
    });
  });

  it("does not let a failing logout mask a successful lookup", async () => {
    stub = stubFetch([
      soap(GUS_LOGIN_RESPONSE),
      soap(GUS_SEARCH_FOUND),
      new Error("connection reset"),
    ]);
    await expect(provider.lookup(plInput(NIP_ORLEN))).resolves.toMatchObject({ success: true });
  });
});
