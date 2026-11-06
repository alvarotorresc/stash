import {
  DEFAULT_PULL_LIMIT,
  MAX_BLOB_BYTES,
  MAX_PULL_LIMIT,
  MAX_PUSH_BODY_BYTES,
  MAX_PUSH_RECORDS,
  MIN_BLOB_BYTES,
  base64UrlDecodedLength,
  isRecordId,
  isRecordKind,
  type RecordKind,
  type RecordsErrorCode,
} from '@stash/core/sync-protocol';
import { jsonError } from '../http';
import { readJsonBody } from '../accounts/validation';

/** An error that is safe to show: it becomes the `{ error }` envelope as is. */
export class RecordsError extends Error {
  constructor(
    readonly code: RecordsErrorCode,
    message: string,
    readonly status: number,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'RecordsError';
  }

  toResponse(): Response {
    return jsonError(this.code, this.message, this.status, this.headers);
  }
}

function invalid(message: string): RecordsError {
  return new RecordsError('VALIDATION_ERROR', message, 400);
}

/** A validated push operation. `size` is the decoded size of the blob (0 for a delete). */
export type ParsedOperation =
  | { op: 'create' | 'put'; id: string; kind: RecordKind; blob: string; size: number }
  | { op: 'delete'; id: string; kind: RecordKind; blob: null; size: 0 };

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Checks a blob's shape and size without decoding it: the server never needs its bytes. */
function blobSize(value: unknown, index: number): { blob: string; size: number } {
  if (typeof value !== 'string' || !BASE64URL.test(value)) {
    throw invalid(`operations[${index}].blob must be base64url`);
  }
  const size = base64UrlDecodedLength(value.length);
  if (size < 0) throw invalid(`operations[${index}].blob must be base64url`);
  if (size < MIN_BLOB_BYTES) throw invalid(`operations[${index}].blob is too short`);
  if (size > MAX_BLOB_BYTES) {
    throw new RecordsError('PAYLOAD_TOO_LARGE', `operations[${index}].blob is too large`, 413);
  }
  return { blob: value, size };
}

function parseOperation(value: unknown, index: number): ParsedOperation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(`operations[${index}] must be an object`);
  }
  const { op, id, kind, blob } = value as Record<string, unknown>;
  if (!isRecordId(id)) throw invalid(`operations[${index}].id must be a lowercase UUID`);
  if (!isRecordKind(kind)) throw invalid(`operations[${index}].kind is not valid`);
  if (op === 'delete') {
    if (blob !== undefined && blob !== null) {
      throw invalid(`operations[${index}].blob is not allowed on a delete`);
    }
    return { op, id, kind, blob: null, size: 0 };
  }
  if (op !== 'create' && op !== 'put') throw invalid(`operations[${index}].op is not valid`);
  return { op, id, kind, ...blobSize(blob, index) };
}

/**
 * Reads and validates the body of `POST /api/records`, streaming and stopping at the limit. The
 * body goes through the same reader as the account routes, so it must be declared JSON.
 */
export async function readPush(request: Request): Promise<ParsedOperation[]> {
  const body = await readJsonBody(request, MAX_PUSH_BODY_BYTES);
  const { operations } = body;
  if (!Array.isArray(operations) || operations.length === 0) {
    throw invalid('operations must be a non-empty array');
  }
  if (operations.length > MAX_PUSH_RECORDS) {
    throw invalid(`At most ${MAX_PUSH_RECORDS} operations per push`);
  }
  const parsed = operations.map(parseOperation);
  if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) {
    throw invalid('Each record can appear only once per push');
  }
  return parsed;
}

/** A pull's position and page size. Cursor 0 means a first load. */
export interface PullQuery {
  readonly cursor: number;
  readonly limit: number;
}

const INTEGER = /^(0|[1-9][0-9]{0,15})$/;

/** Reads `?cursor=` and `?limit=`; the limit is capped at `MAX_PULL_LIMIT`. */
export function readPull(url: URL): PullQuery {
  for (const key of url.searchParams.keys()) {
    if (key !== 'cursor' && key !== 'limit') throw invalid(`Unknown parameter ${key}`);
  }
  const cursorParam = url.searchParams.get('cursor');
  const limitParam = url.searchParams.get('limit');
  let cursor = 0;
  if (cursorParam !== null && cursorParam !== '') {
    if (!INTEGER.test(cursorParam) || !Number.isSafeInteger(Number(cursorParam))) {
      throw invalid('cursor is not valid');
    }
    cursor = Number(cursorParam);
  }
  let limit = DEFAULT_PULL_LIMIT;
  if (limitParam !== null) {
    if (!INTEGER.test(limitParam) || Number(limitParam) < 1) throw invalid('limit is not valid');
    limit = Math.min(Number(limitParam), MAX_PULL_LIMIT);
  }
  return { cursor, limit };
}
