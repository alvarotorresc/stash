import { LONGEST_WINDOW_MS } from './rate-limit';

/**
 * Deletes expired sessions and rate limit windows that have passed. It runs once a day from the
 * cron trigger, off the request path: both tables are scanned whole, which costs reads only,
 * and each deleted row is one written row.
 */
export async function sweepExpiredRows(db: D1Database, now = Date.now()): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE window_start <= ?').bind(now - LONGEST_WINDOW_MS),
  ]);
}
