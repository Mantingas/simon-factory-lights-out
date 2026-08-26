import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { requestLogger } from "./middleware/request-logger.js";
import { companyRoute, type CompanyRouteOptions } from "./routes/company.route.js";
import { healthRoute } from "./routes/health.route.js";

export interface CreateAppOptions extends CompanyRouteOptions {
  /** Disables the access log; useful in tests. */
  quiet?: boolean;
}

export function createApp(options: CreateAppOptions = {}): Hono {
  const app = new Hono();

  app.use("*", secureHeaders());
  app.use("*", cors({ origin: "*", allowMethods: ["GET", "OPTIONS"] }));
  if (!options.quiet) app.use("*", requestLogger());

  app.route("/", healthRoute());
  app.route("/api/v1", companyRoute(options));

  app.onError(errorHandler);
  app.notFound(notFoundHandler);

  return app;
}
