/**
 * Error thrown for any non-2xx response from the IndReelForge API, and for
 * network failures / timeouts (status 0 / 408).
 */
export class IndReelForgeError extends Error {
  /** HTTP status code (0 for network errors, 408 for client-side timeouts). */
  readonly status: number;
  /** Machine-readable error code from the API (`error_code` / `code`), if any. */
  readonly code: string | null;
  /** Parsed response body (JSON object or raw text), if any. */
  readonly body: unknown;

  constructor(message: string, status: number, code: string | null = null, body: unknown = null) {
    super(message);
    this.name = 'IndReelForgeError';
    this.status = status;
    this.code = code;
    this.body = body;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * @deprecated Use {@link IndReelForgeError}. Kept as an alias for 1.0.x code;
 * `err instanceof InReelForgeError` keeps working.
 */
export const InReelForgeError = IndReelForgeError;
/** @deprecated Use {@link IndReelForgeError}. */
export type InReelForgeError = IndReelForgeError;
