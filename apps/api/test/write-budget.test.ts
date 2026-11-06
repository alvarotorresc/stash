import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  AUTH_BUDGET,
  BUDGETED_ACTIONS,
  LIMITS,
  type Action,
  type Limit,
} from '../src/accounts/rate-limit';
import { newSession } from '../src/accounts/sessions';

/**
 * Worst case of rows written to D1 in a day by the routes that count in `rate_limits`, against
 * the Free plan quota of 100 000 written rows a day (every query fails once it is spent). Costs
 * are measured on the real schema; the request counts come from the limits, so raising a cap
 * past the ceiling fails here. The README explains the sum.
 */
const D1_DAILY_WRITES = 100_000;
/** What the account and extraction routes may spend at most; the rest is left for sync. */
const CEILING = 70_000;
const DAY = 24 * 60 * 60 * 1000;

async function written(statement: D1PreparedStatement): Promise<number> {
  return (await statement.run()).meta.rows_written;
}

/**
 * Rows written per statement. Deleting a row is charged like inserting it: local D1 reports
 * fewer rows for some deletes than for the matching insert, and production may not.
 */
interface Costs {
  counterInsert: number;
  counterUpdate: number;
  sessionInsert: number;
  userInsert: number;
  userUpdate: number;
}

async function measure(): Promise<Costs & { deletesWithinInserts: boolean }> {
  const db = env.DB;
  const counter = (sql: string) => db.prepare(sql).bind('measured-key');
  const counterInsert = await written(
    counter('INSERT INTO rate_limits (key, window_start, count) VALUES (?, 0, 1)'),
  );
  const counterUpdate = await written(
    counter('UPDATE rate_limits SET count = count + 1 WHERE key = ?'),
  );
  const counterDelete = await written(counter('DELETE FROM rate_limits WHERE key = ?'));

  const userInsert = await written(
    db.prepare(
      `INSERT INTO users (id, email, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism,
           login_key_hash, recovery_key_hash, wrapped_data_key, recovery_wrapped_data_key,
           created_at, updated_at)
         VALUES ('measured', 'measured@example.com', 's', 1, 1, 1, 'l', 'r', 'w', 'rw', 0, 0)`,
    ),
  );
  const session = await newSession(db, env.PEPPER, 'measured');
  const sessionInsert = (await db.batch(session.statements)).reduce(
    (sum, result) => sum + result.meta.rows_written,
    0,
  );
  const sessionDelete = await written(
    db.prepare("DELETE FROM sessions WHERE user_id = 'measured'"),
  );
  const userUpdate = await written(
    db.prepare(
      `UPDATE users SET salt = 'x', kdf_memory_kib = 2, kdf_iterations = 2, login_key_hash = 'x',
         recovery_key_hash = 'x', wrapped_data_key = 'x', recovery_wrapped_data_key = 'x',
         updated_at = 1 WHERE id = 'measured'`,
    ),
  );
  const userDelete = await written(db.prepare("DELETE FROM users WHERE id = 'measured'"));
  return {
    counterInsert,
    counterUpdate,
    sessionInsert,
    userInsert,
    userUpdate,
    deletesWithinInserts:
      counterDelete <= counterInsert && sessionDelete <= sessionInsert && userDelete <= userInsert,
  };
}

type Buckets = Partial<Record<string, Limit>>;

/** How many requests a bucket lets through in a day. */
function perDay({ max, windowMs }: Limit): number {
  return max * Math.ceil(DAY / windowMs);
}

/**
 * Rows of one accepted request in the given buckets. Subject buckets (IP, email, account) are
 * charged a new key every time, plus its deletion by the sweep, as if the client rotated them;
 * global buckets keep one key that is inserted or updated.
 */
function counterRows(costs: Costs, buckets: string[]): number {
  return buckets.reduce(
    (sum, bucket) =>
      sum +
      (bucket === 'global'
        ? Math.max(costs.counterInsert, costs.counterUpdate)
        : 2 * costs.counterInsert),
    0,
  );
}

/** Buckets counted on every request of the action, the shared budget included. */
function everyRequest(action: Action): string[] {
  const buckets = Object.keys(LIMITS[action] as Buckets).filter((b) => !b.startsWith('failed'));
  return BUDGETED_ACTIONS.has(action) ? [...buckets, 'global'] : buckets;
}

function failureOnly(action: Action): string[] {
  return Object.keys(LIMITS[action] as Buckets).filter((b) => b.startsWith('failed'));
}

/** Worst rows of one accepted request per action, by outcome. */
function rowsPerRequest(costs: Costs): Record<Action, number> {
  // Every session is deleted later: by logout, a password change, a recovery or the sweep.
  const session = 2 * costs.sessionInsert;
  const base = (action: Action) => counterRows(costs, everyRequest(action));
  const failure = (action: Action) => base(action) + counterRows(costs, failureOnly(action));
  return {
    // A new user row and its first session.
    register: base('register') + costs.userInsert + session,
    // A success opens a session; a failure counts the failure buckets instead.
    login: Math.max(base('login') + session, failure('login')),
    // A completed recovery rewrites the user and opens a session.
    recovery: Math.max(base('recovery') + costs.userUpdate + session, failure('recovery')),
    // Password change rewrites the user; account deletion removes it.
    proof: base('proof') + Math.max(costs.userUpdate, costs.userInsert),
    extract: 0,
  };
}

function worstCase(costs: Costs) {
  const rows = rowsPerRequest(costs);
  const budget = AUTH_BUDGET.max;
  const registers = Math.min(budget, perDay(LIMITS.register.global));
  const others = Math.max(rows.login, rows.recovery, rows.proof);
  const auth = Math.max(registers * rows.register + (budget - registers) * others, budget * others);
  // Extraction keys stay stable: an account's key is inserted and swept at most once a day, so
  // a request costs an update of its account key and of the global key. That assumption holds
  // while the accounts that extract in a day are few next to the extractions.
  const extractPerRequest = everyRequest('extract').length * costs.counterUpdate;
  const extract = perDay(LIMITS.extract.global) * extractPerRequest;
  return { rows, auth, extract, total: auth + extract };
}

describe('daily D1 write budget', () => {
  it('should account for every rate limited action', () => {
    const modelled: Action[] = ['register', 'login', 'recovery', 'proof', 'extract'];

    expect((Object.keys(LIMITS) as Action[]).sort()).toEqual([...modelled].sort());
  });

  it('should count the account actions in a daily budget', () => {
    expect({ windowMs: AUTH_BUDGET.windowMs, actions: [...BUDGETED_ACTIONS].sort() }).toEqual({
      windowMs: DAY,
      actions: ['login', 'proof', 'recovery', 'register'],
    });
  });

  it('should measure one written row per counter and two per session', async () => {
    const costs = await measure();

    expect(costs).toEqual({
      counterInsert: 1,
      counterUpdate: 1,
      sessionInsert: 2,
      userInsert: 3,
      userUpdate: 1,
      deletesWithinInserts: true,
    });
  });

  it('should keep the worst day of abuse under the ceiling', async () => {
    const worst = worstCase(await measure());

    expect({
      ...worst,
      underCeiling: worst.total <= CEILING,
      underQuota: worst.total < D1_DAILY_WRITES,
    }).toEqual({
      rows: { register: 11, login: 8, recovery: 9, proof: 6, extract: 0 },
      auth: 45_200,
      extract: 20_000,
      total: 65_200,
      underCeiling: true,
      underQuota: true,
    });
  });
});
