import { LONGEST_WINDOW_MS } from './rate-limit';

/**
 * Rows deleted at most per table in one run. Every deleted row is a written row, so one run can
 * never spend more than this of the daily D1 write quota on a table, whatever piled up. It stays
 * above what a day of requests can leave behind, so the tables do not grow, and those deletions
 * are already counted in the daily write budget (see the README).
 */
export const SWEEP_MAX_ROWS = 25_000;

/**
 * Records of deleted accounts purged at most in one run. Those records were written on earlier
 * days, so their deletion is a cost of its own in the daily write budget; this cap bounds it
 * whatever was deleted, and a full account is gone within a few days.
 */
export const PURGE_MAX_RECORDS = 1_000;

/**
 * Deletes expired sessions and rate limit windows that have passed, at most `maxRows` per
 * table, and purges at most `maxPurgedRecords` records of deleted accounts. It runs once a day
 * from the cron trigger, off the request path: the tables are scanned, which costs reads only,
 * and each deleted row is a written row.
 */
export async function sweepExpiredRows(
  db: D1Database,
  now = Date.now(),
  maxRows = SWEEP_MAX_ROWS,
  maxPurgedRecords = PURGE_MAX_RECORDS,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM sessions WHERE token_hash IN
           (SELECT token_hash FROM sessions WHERE expires_at <= ? LIMIT ?)`,
      )
      .bind(now, maxRows),
    db
      .prepare(
        `DELETE FROM rate_limits WHERE key IN
           (SELECT key FROM rate_limits WHERE window_start <= ? LIMIT ?)`,
      )
      .bind(now - LONGEST_WINDOW_MS, maxRows),
    db
      .prepare(
        `DELETE FROM records WHERE rowid IN
           (SELECT records.rowid FROM deleted_users
              JOIN records ON records.user_id = deleted_users.id LIMIT ?)`,
      )
      .bind(maxPurgedRecords),
  ]);
}
