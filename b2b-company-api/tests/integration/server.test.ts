import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serve, type ServerType } from "@hono/node-server";
import { createApp } from "../../src/app.js";
import { CompanyCache } from "../../src/cache/company.cache.js";
import { ProviderRegistry } from "../../src/providers/index.js";
import { CompanyService } from "../../src/services/company.service.js";
import { companyFor, stubProvider } from "../helpers/stub-provider.js";

/**
 * Boots the real Node adapter on an ephemeral port and drives it with `fetch`,
 * so the `@hono/node-server` wiring is covered and not just `app.request()`.
 */
describe("node-server adapter", () => {
  let server: ServerType;
  let baseUrl: string;

  beforeAll(async () => {
    const vies = stubProvider("VIES", (input) => companyFor(input, "VIES"));
    const gus = stubProvider("GUS_BIR", (input) => companyFor(input, "GUS_BIR"));
    const app = createApp({
      quiet: true,
      service: new CompanyService({
        registry: new ProviderRegistry({ gus, vies }),
        cache: new CompanyCache({ ttlMs: 60_000, maxEntries: 10 }),
      }),
    });

    server = await new Promise<ServerType>((resolve) => {
      const instance = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
        baseUrl = `http://127.0.0.1:${info.port}`;
        resolve(instance);
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves /health over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: "ok" });
  });

  it("serves a company lookup over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/api/v1/company?country=LT&code=100001919817`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      country: "LT",
      source: "VIES",
    });
  });

  it("returns a JSON error envelope over real HTTP", async () => {
    const res = await fetch(`${baseUrl}/api/v1/company?country=LT`);
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
