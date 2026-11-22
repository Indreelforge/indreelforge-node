/**
 * Error thrown for any non-2xx response from the Post-Upload API, and for
 * network failures / timeouts (status 0 / 408).
 */
export class PostUploadError extends Error {
  /** HTTP status code (0 for network errors, 408 for client-side timeouts). */
  readonly status: number;
  /** Machine-readable error code from the API (`error_code` / `code`), if any. */
  readonly code: string | null;
  /** Parsed response body (JSON object or raw text), if any. */
  readonly body: unknown;
  /** Seconds from the response's `Retry-After` header (e.g. on 429), if any. */
  retryAfter: number | null = null;

  constructor(message: string, status: number, code: string | null = null, body: unknown = null) {
    super(message);
    this.name = 'PostUploadError';
    this.status = status;
    this.code = code;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * @deprecated Use {@link PostUploadError}. Alias kept from the `indreelforge`
 * package; `err instanceof IndReelForgeError` keeps working.
 */
export const IndReelForgeError = PostUploadError;
/** @deprecated Use {@link PostUploadError}. */
export type IndReelForgeError = PostUploadError;

/**
 * @deprecated Use {@link PostUploadError}. Alias kept for 1.0.x code;
 * `err instanceof InReelForgeError` keeps working.
 */
export const InReelForgeError = PostUploadError;
/** @deprecated Use {@link PostUploadError}. */
export type InReelForgeError = PostUploadError;
