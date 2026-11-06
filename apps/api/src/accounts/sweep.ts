import { LONGEST_WINDOW_MS } from './rate-limit';

/**
 * Rows deleted at most per table in one run. Every deleted row is a written row, so one run can
 * never spend more than this of the daily D1 write quota on a table, whatever piled up. It stays
 * above what a day of requests can leave behind, so the tables do not grow, and those deletions
 * are already counted in the daily write budget (see the README).
 */
export const SWEEP_MAX_ROWS = 25_000;

/**
 * Deletes expired sessions and rate limit windows that have passed, at most `maxRows` per
 * table. It runs once a day from the cron trigger, off the request path: both tables are
 * scanned whole, which costs reads only, and each deleted row is one written row.
 */
export async function sweepExpiredRows(
  db: D1Database,
  now = Date.now(),
  maxRows = SWEEP_MAX_ROWS,
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
  ]);
}
