import { Hono } from "hono";
import { ApiError } from "../errors.js";
import { companyQuerySchema, toLookupInput } from "../schemas.js";
import { CompanyService, companyService } from "../services/company.service.js";
import type { CompanyResponse } from "../types.js";

export interface CompanyRouteOptions {
  service?: CompanyService;
}

function parseRefresh(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

/**
 * Mounted under `/api/v1`. Both the query-string and the path form resolve to
 * the same handler so callers can use whichever fits their client.
 */
export function companyRoute(options: CompanyRouteOptions = {}): Hono {
  const app = new Hono();
  const service = options.service ?? companyService;

  const handle = async (
    rawCountry: string | undefined,
    rawCode: string | undefined,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<CompanyResponse> => {
    const parsed = companyQuerySchema.safeParse({ country: rawCountry, code: rawCode });
    if (!parsed.success) {
      throw ApiError.validation(
        "Invalid request parameters.",
        parsed.error.issues.map((issue) => ({
          field: issue.path.join(".") || "(root)",
          message: issue.message,
        })),
      );
    }
    return service.lookup(toLookupInput(parsed.data), { refresh, signal });
  };

  app.get("/company", async (c) => {
    const result = await handle(
      c.req.query("country"),
      c.req.query("code"),
      parseRefresh(c.req.query("refresh")),
      c.req.raw.signal,
    );
    return c.json(result);
  });

  app.get("/company/:country/:code", async (c) => {
    const result = await handle(
      c.req.param("country"),
      c.req.param("code"),
      parseRefresh(c.req.query("refresh")),
      c.req.raw.signal,
    );
    return c.json(result);
  });

  return app;
}
