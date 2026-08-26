import { describe, expect, it } from "vitest";
import { clientIp, maskKey } from "../../src/middleware/auth.js";

describe("maskKey", () => {
  it("keeps a short identifying prefix and hides the rest", () => {
    expect(maskKey("sk-live-abcdefghijklmnop")).toBe("sk-l********");
  });

  it("never echoes the whole key", () => {
    const key = "sk-live-secret";
    expect(maskKey(key)).not.toContain("secret");
  });

  it("fully masks a very short key", () => {
    expect(maskKey("abcd")).toBe("****");
    expect(maskKey("")).toBe("****");
  });
});

describe("clientIp", () => {
  it("ignores x-forwarded-for when the proxy is not trusted", () => {
    expect(clientIp("9.9.9.9", "10.0.0.1", false)).toBe("10.0.0.1");
  });

  it("uses the left-most forwarded entry when the proxy is trusted", () => {
    expect(clientIp("9.9.9.9, 10.0.0.1", "10.0.0.1", true)).toBe("9.9.9.9");
  });

  it("falls back to the socket address when the header is absent", () => {
    expect(clientIp(undefined, "10.0.0.1", true)).toBe("10.0.0.1");
  });

  it("falls back to the socket address when the header is blank", () => {
    expect(clientIp("   ", "10.0.0.1", true)).toBe("10.0.0.1");
  });

  it("returns a stable placeholder when nothing identifies the caller", () => {
    expect(clientIp(undefined, undefined, true)).toBe("unknown");
  });
});
