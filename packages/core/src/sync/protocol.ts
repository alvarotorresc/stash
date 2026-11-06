/**
 * Wire contract of the records API (`/api/records`), shared by the clients and the Worker. Types
 * and constants only, with no cryptography, IndexedDB or DOM types, so the Worker can import it
 * through `@stash/core/sync-protocol`.
 *
 * The server only ever sees encrypted blobs: what a record holds, including its title, URL,
 * category or tags, lives inside the blob.
 */

export const RECORDS_PATH = '/api/records';

export const RECORD_KINDS = ['item', 'category', 'tag'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * Largest blob, in decoded bytes (1 MiB). An item carries its read content and its compressed
 * thumbnail, so this is generous; base64url makes it about 1.4 MB, under the 2 MB row limit of
 * D1. Clients shrink an item that does not fit (see `fitItem`) instead of failing the save.
 */
export const MAX_BLOB_BYTES = 1024 * 1024;
/** Smallest possible blob: the sealed format's version byte, 12-byte nonce and 16-byte tag. */
export const MIN_BLOB_BYTES = 29;

/** Most operations in one push. */
export const MAX_PUSH_RECORDS = 100;
/**
 * Largest push body, in bytes. Keeps parsing a push inside the Worker's CPU budget; a single
 * maximum blob (about 1.4 MB as base64url) always fits.
 */
export const MAX_PUSH_BODY_BYTES = 4 * 1024 * 1024;

/** Records returned by a pull page when the client does not ask for a size. */
export const DEFAULT_PULL_LIMIT = 200;
/** Most records in one pull page. */
export const MAX_PULL_LIMIT = 500;
/**
 * Most blob bytes in one pull page (decoded). A page stops before going over it, but always
 * carries at least one record.
 */
export const MAX_PULL_PAGE_BYTES = 3 * 1024 * 1024;

/** Most records an account can keep, deleted ones included (they stay as small tombstones). */
export const MAX_RECORDS_PER_ACCOUNT = 5_000;
/** Most blob bytes an account can keep (decoded): 5 KiB per record on average. */
export const MAX_BYTES_PER_ACCOUNT = 25 * 1024 * 1024;

/** Record ids are random UUIDs generated on the client, in lowercase canonical form. */
export const RECORD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

export function isRecordKind(value: unknown): value is RecordKind {
  return typeof value === 'string' && (RECORD_KINDS as readonly string[]).includes(value);
}

/**
 * One operation of a push.
 * - `create`: stores the record only if the id is new. Retrying it (a queued save that was
 *   already uploaded) changes nothing, so it never overwrites a later edit nor revives a
 *   deleted record.
 * - `put`: stores the record whatever the server has: the last write wins. It also undoes a
 *   delete.
 * - `delete`: replaces the record with a tombstone (no blob). Deleting an unknown or already
 *   deleted record changes nothing.
 */
export type PushOperation =
  | {
      readonly op: 'create' | 'put';
      readonly id: string;
      readonly kind: RecordKind;
      readonly blob: string;
    }
  | { readonly op: 'delete'; readonly id: string; readonly kind: RecordKind };

/** Body of `POST /api/records`. */
export interface PushRequest {
  readonly operations: readonly PushOperation[];
}

/** Outcome of one operation, in the order they were sent. */
export interface PushResult {
  readonly id: string;
  /** Whether the operation changed the record (false for a retried create or a no-op). */
  readonly applied: boolean;
  /** The record's version on the server after the operation, or null if it does not exist. */
  readonly version: number | null;
}

/** `data` of `POST /api/records`. */
export interface PushResponse {
  readonly results: readonly PushResult[];
}

/** A record as `GET /api/records` returns it. `blob` is null for a deleted record. */
export interface WireRecord {
  readonly id: string;
  readonly kind: RecordKind;
  readonly version: number;
  readonly deleted: boolean;
  /** Encrypted blob in base64url, or null for a tombstone. */
  readonly blob: string | null;
}

/**
 * `GET /api/records?cursor=<cursor>&limit=<n>` answers `{ data: WireRecord[], meta: PullMeta }`.
 * Without a cursor (first load) deleted records are left out. `nextCursor` is never null: it is
 * where the next pull starts, also when there is nothing more to read.
 */
export interface PullMeta {
  readonly nextCursor: string;
  readonly hasMore: boolean;
}

/** Error codes of the records API, besides the shared ones (`UNAUTHORIZED`, `RATE_LIMITED`...). */
export type RecordsErrorCode =
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR';

/** Decoded length of an unpadded base64url string, or -1 if no base64url string has it. */
export function base64UrlDecodedLength(length: number): number {
  if (length % 4 === 1) return -1;
  return Math.floor((length * 3) / 4);
}
