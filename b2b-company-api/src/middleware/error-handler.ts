import type { Context, ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../errors.js";
import { logger } from "../utils/logger.js";

/** Converts anything thrown in a handler into the API's error envelope. */
export const errorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      logger.error("request failed", { path: c.req.path, code: error.code, message: error.message });
    } else {
      logger.info("request rejected", { path: c.req.path, code: error.code });
    }
    return c.json(error.toBody(), error.status);
  }

  if (error instanceof HTTPException) {
    const wrapped = new ApiError(
      error.status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_ERROR",
      error.message,
      error.status,
    );
    return c.json(wrapped.toBody(), wrapped.status);
  }

  logger.error("unhandled error", {
    path: c.req.path,
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  const internal = ApiError.internal();
  return c.json(internal.toBody(), internal.status);
};

export const notFoundHandler: NotFoundHandler = (c: Context) =>
  c.json(ApiError.notFound(`No route matches ${c.req.method} ${c.req.path}.`).toBody(), 404);
