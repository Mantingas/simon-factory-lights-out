import { afterEach, describe, expect, it, vi } from "vitest";
import { httpRequest } from "../../src/utils/http.js";

/** A fetch that never resolves until its abort signal fires. */
function hangingFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        });
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpRequest", () => {
  it("aborts and reports a timeout once the deadline passes", async () => {
    vi.stubGlobal("fetch", hangingFetch());

    await expect(
      httpRequest("https://slow.test/x", { label: "Slow", timeoutMs: 30, retries: 0 }),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  });

  it("retries after a timeout up to the configured limit", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      httpRequest("https://slow.test/x", { label: "Slow", timeoutMs: 20, retries: 2 }),
    ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces a caller-side cancellation instead of retrying it", async () => {
    const fetchMock = hangingFetch();
    vi.stubGlobal("fetch", fetchMock);

    const controller = new AbortController();
    const promise = httpRequest("https://slow.test/x", {
      label: "Slow",
      timeoutMs: 5000,
      retries: 3,
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unreachable host as an upstream error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("fetch failed"))));

    await expect(
      httpRequest("https://nowhere.test/x", { label: "Nowhere", retries: 0 }),
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 502 });
  });

  it("returns a non-retryable error status to the caller instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))));

    const response = await httpRequest("https://x.test/x", { label: "X", retries: 2 });
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(response.body).toBe("nope");
  });

  it("defaults to GET with no body", async () => {
    const fetchMock = vi.fn((_input: unknown, init?: RequestInit) => {
      expect(init).toMatchObject({ method: "GET" });
      expect(init?.body).toBeUndefined();
      return Promise.resolve(new Response("ok", { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await httpRequest("https://x.test/x", { label: "X" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
