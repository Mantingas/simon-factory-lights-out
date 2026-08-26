import type { MiddlewareHandler } from "hono";
import { logger } from "../utils/logger.js";

/** Structured access log with a request id echoed back on `x-request-id`. */
export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);

    const startedAt = performance.now();
    await next();
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;

    logger.info("request", {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs,
    });
  };
}
