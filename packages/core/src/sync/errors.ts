/**
 * Why a sync operation failed.
 * - `OFFLINE`: there is no connection (or the server could not be reached). Edits need the
 *   network; saving a new link goes to the queue instead of failing.
 * - `LOCKED`: there is no session or no data key on this device: log in again.
 * - `UNAUTHORIZED`: the server closed the session.
 * - `NOT_FOUND`: the item, category or tag is not in the local copy.
 * - `INVALID_INPUT`: a name or URL that cannot be saved.
 * - `TOO_LARGE`: the record cannot fit the server's size limit even after shrinking it.
 * - `QUOTA_EXCEEDED`, `RATE_LIMITED`, `CONFLICT`: the server refused the change.
 * - `BAD_RESPONSE`, `SERVER_ERROR`: the server answered something unexpected or failed.
 */
export type SyncErrorCode =
  | 'BAD_RESPONSE'
  | 'CONFLICT'
  | 'INVALID_INPUT'
  | 'LOCKED'
  | 'NOT_FOUND'
  | 'OFFLINE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TOO_LARGE'
  | 'UNAUTHORIZED';

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
    /** HTTP status when the error came from the server, 0 otherwise. */
    readonly status = 0,
    /** Seconds to wait before retrying, from `Retry-After` on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}
