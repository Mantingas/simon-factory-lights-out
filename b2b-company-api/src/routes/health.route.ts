import { Hono } from "hono";

export interface HealthResponse {
  status: "ok";
  timestamp: string;
}

export function healthRoute(): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json<HealthResponse>({ status: "ok", timestamp: new Date().toISOString() }),
  );

  return app;
}
