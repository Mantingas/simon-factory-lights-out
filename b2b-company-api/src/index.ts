import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";

const app = createApp();

const server = serve({ fetch: app.fetch, port: config.PORT, hostname: config.HOST }, (info) => {
  logger.info("server listening", { address: `http://${config.HOST}:${info.port}` });
});

// Without a listener, a bind failure surfaces as an unhandled 'error' event and
// a raw stack trace. Report the cause and exit non-zero instead.
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error("port is already in use", { host: config.HOST, port: config.PORT });
  } else {
    logger.error("server error", { code: error.code, message: error.message });
  }
  process.exit(1);
});

function shutdown(signal: string): void {
  logger.info("shutting down", { signal });
  server.close(() => process.exit(0));
  // Don't let an in-flight upstream call hold the process open indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
