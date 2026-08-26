import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNSUPPORTED_COUNTRY"
  | "UPSTREAM_ERROR"
  | "UPSTREAM_TIMEOUT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: ContentfulStatusCode,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toBody(): ApiErrorBody {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  static validation(message: string, details?: unknown): ApiError {
    return new ApiError("VALIDATION_ERROR", message, 400, details);
  }

  static notFound(message: string, details?: unknown): ApiError {
    return new ApiError("NOT_FOUND", message, 404, details);
  }

  static unsupportedCountry(country: string): ApiError {
    return new ApiError(
      "UNSUPPORTED_COUNTRY",
      `No provider is configured for country '${country}'.`,
      422,
      { country },
    );
  }

  static upstream(message: string, details?: unknown): ApiError {
    return new ApiError("UPSTREAM_ERROR", message, 502, details);
  }

  static timeout(message: string, details?: unknown): ApiError {
    return new ApiError("UPSTREAM_TIMEOUT", message, 504, details);
  }

  static internal(message = "Unexpected internal error.", details?: unknown): ApiError {
    return new ApiError("INTERNAL_ERROR", message, 500, details);
  }
}
