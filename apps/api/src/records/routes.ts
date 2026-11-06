/**
 * `GET /api/records` (pull changes from a cursor) and `POST /api/records` (push a batch).
 *
 * The server stores encrypted blobs and never sees what a record holds. Every query is
 * parameterised and filtered by the account of the session, never by anything in the request.
 *
 * Versions are assigned here: each change takes the account's highest version plus one, inside
 * the statement that makes it. D1 runs a batch as one transaction and serialises writes, so
 * versions are unique and increase in commit order, which is what makes them a safe cursor.
 * Conflicts resolve by last write wins: the change the server applies last gets the highest
 * version and is what every device ends up with.
 */

import {
  MAX_BYTES_PER_ACCOUNT,
  MAX_PULL_PAGE_BYTES,
  MAX_RECORDS_PER_ACCOUNT,
  RECORDS_PATH,
  type PullMeta,
  type PushResult,
  type RecordKind,
  type WireRecord,
} from '@stash/core/sync-protocol';
import { readPepper, type AccountsEnv } from '../accounts/env';
import { ApiError } from '../accounts/errors';
import { enforceRateLimit } from '../accounts/rate-limit';
import { createSessionResolver, requireSession } from '../auth/session';
import { jsonData, jsonError, jsonPage } from '../http';
import { RecordsError, readPull, readPush, type ParsedOperation } from './validation';
import { pushWeight } from './weight';

interface Context {
  readonly request: Request;
  readonly db: D1Database;
  readonly pepper: string;
  readonly accountId: string;
  readonly now: number;
}

interface ExistingRow {
  id: string;
  kind: RecordKind;
  version: number;
  deleted: number;
  size: number;
}

/** The account's next version, computed inside the statement that uses it. */
const NEXT_VERSION = '(SELECT coalesce(max(version), 0) + 1 FROM records WHERE user_id = ?1)';

const INSERT = `INSERT INTO records (user_id, id, kind, version, deleted, blob, size, created_at, updated_at)
  VALUES (?1, ?2, ?3, ${NEXT_VERSION}, 0, ?4, ?5, ?6, ?6)`;

/** Only stores a new id: retrying a create never overwrites a later edit or a delete. */
export const CREATE = `${INSERT} ON CONFLICT (user_id, id) DO NOTHING RETURNING version`;

/**
 * Last write wins, also over a tombstone (undo of a delete). Sending the same blob again
 * changes nothing, so a retried put does not bump the version.
 */
export const PUT = `${INSERT}
  ON CONFLICT (user_id, id) DO UPDATE SET version = excluded.version, deleted = 0,
    blob = excluded.blob, size = excluded.size, updated_at = excluded.updated_at
  WHERE records.kind = excluded.kind AND (records.deleted = 1 OR records.blob IS NOT excluded.blob)
  RETURNING version`;

/** Logical delete: the row stays as a tombstone with no blob, so other devices see it go. */
export const DELETE = `UPDATE records SET deleted = 1, blob = NULL, size = 0, updated_at = ?4,
    version = ${NEXT_VERSION}
  WHERE user_id = ?1 AND id = ?2 AND kind = ?3 AND deleted = 0
  RETURNING version`;

function statementFor(context: Context, operation: ParsedOperation): D1PreparedStatement {
  const { db, accountId, now } = context;
  const { op, id, kind } = operation;
  if (op === 'delete') return db.prepare(DELETE).bind(accountId, id, kind, now);
  return db
    .prepare(op === 'create' ? CREATE : PUT)
    .bind(accountId, id, kind, operation.blob, operation.size, now);
}

/**
 * Rejects a push that would take the account over its quotas. A push that does not grow the
 * account (deletes, smaller blobs) always goes through. Two pushes running at the same time can
 * each pass the check, so the quota is soft by at most one push.
 */
function checkQuota(
  operations: ParsedOperation[],
  existing: Map<string, ExistingRow>,
  current: { records: number; bytes: number },
): void {
  let { records, bytes } = current;
  for (const operation of operations) {
    const row = existing.get(operation.id);
    if (operation.op === 'delete') {
      if (row !== undefined && row.deleted === 0) bytes -= row.size;
    } else if (row === undefined) {
      records += 1;
      bytes += operation.size;
    } else if (operation.op === 'put') {
      bytes += operation.size - row.size;
    }
  }
  const tooMany = records > MAX_RECORDS_PER_ACCOUNT && records > current.records;
  const tooBig = bytes > MAX_BYTES_PER_ACCOUNT && bytes > current.bytes;
  if (tooMany || tooBig) {
    throw new RecordsError('QUOTA_EXCEEDED', 'The account has no room for these records', 413);
  }
}

async function push(context: Context): Promise<Response> {
  const { request, db, pepper, accountId, now } = context;
  // The body is checked first: a refused body costs no write. The push is then counted by the
  // rows it can write, before any read of the records, so a refused push costs no reads either.
  const operations = await readPush(request);
  const weight = pushWeight(operations);
  await enforceRateLimit(db, pepper, 'recordsPush', { account: accountId }, now, weight);

  const [existingResult, countsResult] = await db.batch([
    db
      .prepare(
        `SELECT id, kind, version, deleted, size FROM records
         WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
      )
      .bind(accountId, JSON.stringify(operations.map(({ id }) => id))),
    db.prepare('SELECT records, bytes FROM record_counts WHERE user_id = ?').bind(accountId),
  ]);
  const existing = new Map(
    ((existingResult?.results ?? []) as ExistingRow[]).map((row) => [row.id, row]),
  );
  for (const operation of operations) {
    const row = existing.get(operation.id);
    if (row !== undefined && row.kind !== operation.kind) {
      throw new RecordsError('CONFLICT', 'A record cannot change its kind', 409);
    }
  }
  const counts = (countsResult?.results[0] as { records: number; bytes: number } | undefined) ?? {
    records: 0,
    bytes: 0,
  };
  checkQuota(operations, existing, counts);

  const written = await db.batch<{ version: number }>(
    operations.map((operation) => statementFor(context, operation)),
  );
  const results: PushResult[] = operations.map(({ id }, index) => {
    const row = written[index]?.results[0];
    if (row !== undefined) return { id, applied: true, version: row.version };
    return { id, applied: false, version: existing.get(id)?.version ?? null };
  });
  return jsonData({ results });
}

interface PageRow {
  id: string;
  version: number;
  size: number;
}

interface RecordRow {
  id: string;
  kind: RecordKind;
  version: number;
  deleted: number;
  blob: string | null;
}

/**
 * A page of changes after the cursor, in version order. The page is cut by count and by blob
 * bytes, in two steps so no blob is read beyond the page: first the ids and sizes, then the
 * blobs of the rows that fit. A first load (cursor 0) leaves tombstones out.
 */
async function pull(context: Context): Promise<Response> {
  const { request, db, pepper, accountId, now } = context;
  await enforceRateLimit(db, pepper, 'recordsPull', { account: accountId }, now);
  const { cursor, limit } = readPull(new URL(request.url));

  const [candidatesResult, headResult] = await db.batch([
    db
      .prepare(
        `SELECT id, version, size FROM records
         WHERE user_id = ?1 AND version > ?2 AND (?2 > 0 OR deleted = 0)
         ORDER BY version LIMIT ?3`,
      )
      .bind(accountId, cursor, limit + 1),
    db
      .prepare('SELECT coalesce(max(version), 0) AS head FROM records WHERE user_id = ?')
      .bind(accountId),
  ]);
  const candidates = (candidatesResult?.results ?? []) as PageRow[];
  const head = (headResult?.results[0] as { head: number } | undefined)?.head ?? 0;

  let bytes = 0;
  let take = 0;
  for (const row of candidates) {
    // The first row always goes in, so a page is never empty while there is more to read.
    if (take === limit || (take > 0 && bytes + row.size > MAX_PULL_PAGE_BYTES)) break;
    bytes += row.size;
    take += 1;
  }
  const hasMore = take < candidates.length;
  const last = candidates[take - 1]?.version;

  let records: WireRecord[] = [];
  if (last !== undefined) {
    const { results } = await db
      .prepare(
        `SELECT id, kind, version, deleted, blob FROM records
         WHERE user_id = ?1 AND version > ?2 AND version <= ?3 AND (?2 > 0 OR deleted = 0)
         ORDER BY version`,
      )
      .bind(accountId, cursor, last)
      .all<RecordRow>();
    records = results.map(({ id, kind, version, deleted, blob }) => ({
      id,
      kind,
      version,
      deleted: deleted === 1,
      blob: deleted === 1 ? null : blob,
    }));
  }
  // At the end of the feed the cursor jumps to the head, past any tombstone a first load skipped.
  const meta: PullMeta = {
    nextCursor: String(hasMore ? (last as number) : head),
    hasMore,
  };
  return jsonPage(records, meta);
}

export function isRecordsPath(pathname: string): boolean {
  return pathname === RECORDS_PATH;
}

/** Handles `/api/records`: every method needs a session and counts in the account's limits. */
export async function handleRecordsRequest(request: Request, env: AccountsEnv): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') {
    return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { Allow: 'GET, POST' });
  }
  return requireSession(createSessionResolver(env), async (_request, session) => {
    try {
      const context: Context = {
        request,
        db: env.DB,
        pepper: readPepper(env),
        accountId: session.accountId,
        now: Date.now(),
      };
      return await (method === 'GET' ? pull(context) : push(context));
    } catch (error) {
      if (error instanceof RecordsError || error instanceof ApiError) return error.toResponse();
      // Only the error's name: messages could carry request data, which is never logged.
      console.error(`records: unexpected ${error instanceof Error ? error.name : 'error'}`);
      return jsonError('INTERNAL_ERROR', 'Something went wrong', 500);
    }
  })(request);
}
