import { vi } from "vitest";

export interface StubbedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface StubResponse {
  status?: number;
  body: string;
  headers?: Record<string, string>;
}

export interface FetchStub {
  calls: StubbedCall[];
  restore(): void;
}

/**
 * Replaces global `fetch` with a queue-driven stub. Each entry is consumed in
 * order, so tests can assert on a multi-step protocol (GUS login -> search ->
 * logout) without a live upstream. An entry may also be a thrown error, to
 * simulate a transport failure.
 */
export function stubFetch(responses: Array<StubResponse | Error>): FetchStub {
  const calls: StubbedCall[] = [];
  const queue = [...responses];
  const original = globalThis.fetch;

  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });

    calls.push({
      url: typeof input === "string" ? input : input.toString(),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    const next = queue.shift();
    if (!next) throw new Error(`fetch stub exhausted after ${calls.length} call(s)`);
    if (next instanceof Error) throw next;

    return new Response(next.body, {
      status: next.status ?? 200,
      headers: next.headers ?? { "content-type": "application/json" },
    });
  };

  vi.stubGlobal("fetch", vi.fn(impl));

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
      vi.unstubAllGlobals();
    },
  };
}
