import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ApiError } from "../../src/errors.js";
import { errorHandler, notFoundHandler } from "../../src/middleware/error-handler.js";

function appThatThrows(error: unknown): Hono {
  const app = new Hono();
  app.get("/boom", () => {
    throw error;
  });
  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}

describe("errorHandler", () => {
  it("renders an ApiError with its own status and code", async () => {
    const res = await appThatThrows(ApiError.notFound("gone", { id: 1 })).request("/boom");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: { code: "NOT_FOUND", message: "gone", details: { id: 1 } },
    });
  });

  it("omits details when the error carries none", async () => {
    const res = await appThatThrows(ApiError.validation("bad")).request("/boom");
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "bad" },
    });
  });

  it("maps a 4xx HTTPException to VALIDATION_ERROR", async () => {
    const res = await appThatThrows(new HTTPException(413, { message: "too big" })).request("/boom");
    expect(res.status).toBe(413);
    await expect(res.json()).resolves.toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "too big" },
    });
  });

  it("maps a 5xx HTTPException to INTERNAL_ERROR", async () => {
    const res = await appThatThrows(new HTTPException(503, { message: "down" })).request("/boom");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({ error: { code: "INTERNAL_ERROR" } });
  });

  it("hides the details of an unexpected throw", async () => {
    const res = await appThatThrows(new RangeError("internal detail")).request("/boom");
    expect(res.status).toBe(500);
    const body = (await res.text()).toLowerCase();
    expect(body).not.toContain("internal detail");
    expect(body).toContain("internal_error");
  });
});

describe("notFoundHandler", () => {
  it("names the method and path that did not match", async () => {
    const res = await appThatThrows(new Error("unused")).request("/missing");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: "NOT_FOUND", message: "No route matches GET /missing." },
    });
  });
});
