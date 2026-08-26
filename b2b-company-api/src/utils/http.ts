import { config } from "../config.js";
import { ApiError } from "../errors.js";
import { logger } from "./logger.js";

export interface HttpRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Overrides `UPSTREAM_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Number of *extra* attempts after the first. Overrides `UPSTREAM_RETRIES`. */
  retries?: number;
  /** Caller-supplied cancellation, composed with the internal timeout. */
  signal?: AbortSignal;
  /** Used in error messages and logs. */
  label: string;
}

export interface HttpResponse {
  status: number;
  ok: boolean;
  body: string;
  headers: Headers;
}

/** Retrying a non-idempotent POST is safe here: both upstreams are read-only lookups. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

const backoffMs = (attempt: number) => Math.min(250 * 2 ** attempt, 2000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `fetch` with a hard timeout, bounded retries and upstream errors normalized
 * into `ApiError`, so provider adapters only deal with response bodies.
 */
export async function httpRequest(
  url: string,
  options: HttpRequestOptions,
): Promise<HttpResponse> {
  const timeoutMs = options.timeoutMs ?? config.UPSTREAM_TIMEOUT_MS;
  const maxRetries = options.retries ?? config.UPSTREAM_RETRIES;

  let lastError: ApiError | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutController.signal])
      : timeoutController.signal;

    try {
      const response = await fetch(url, {
        method: options.method ?? "GET",
        headers: options.headers,
        body: options.body,
        signal,
      });
      const body = await response.text();

      if (!response.ok && isRetryableStatus(response.status) && attempt < maxRetries) {
        lastError = ApiError.upstream(
          `${options.label} responded with HTTP ${response.status}.`,
          { status: response.status },
        );
        logger.warn("upstream retryable status", {
          label: options.label,
          status: response.status,
          attempt,
        });
        await sleep(backoffMs(attempt));
        continue;
      }

      return { status: response.status, ok: response.ok, body, headers: response.headers };
    } catch (error) {
      // The caller aborted — surface that rather than retrying their cancelled request.
      if (options.signal?.aborted) {
        throw ApiError.upstream(`${options.label} request was cancelled.`);
      }

      lastError = timeoutController.signal.aborted
        ? ApiError.timeout(`${options.label} timed out after ${timeoutMs}ms.`)
        : ApiError.upstream(`${options.label} is unreachable.`, {
            cause: error instanceof Error ? error.message : String(error),
          });

      logger.warn("upstream request failed", {
        label: options.label,
        attempt,
        error: lastError.message,
      });

      if (attempt >= maxRetries) break;
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? ApiError.upstream(`${options.label} request failed.`);
}
