import { env } from 'cloudflare:workers';
import { meteredDb } from './metered-db';
import { describe, expect, it } from 'vitest';
import {
  AUTH_BUDGET,
  BUDGETED_ACTIONS,
  LIMITS,
  type Action,
  type Limit,
} from '../src/accounts/rate-limit';
import { newSession } from '../src/accounts/sessions';
import { PURGE_MAX_RECORDS, sweepExpiredRows } from '../src/accounts/sweep';
import { DELETE_ACCOUNT_STATEMENTS } from '../src/accounts/users';
import { CREATE, DELETE, PUT } from '../src/records/routes';
import { FIRST_RECORD_ROWS, OPERATION_ROWS, PUSH_REQUEST_ROWS } from '../src/records/weight';
import { MAX_PUSH_RECORDS } from '@stash/core/sync-protocol';

/**
 * Worst case of rows written to D1 in a day by the routes that count in `rate_limits` and by the
 * daily sweep, against the Free plan quota of 100 000 written rows a day (every query fails once
 * it is spent). Costs are measured on the real schema; the request counts come from the limits,
 * so raising a cap past the ceiling fails here. The README explains the sum.
 */
const D1_DAILY_WRITES = 100_000;
/** What everything together may spend at most: a 5 % margin under the quota. */
const CEILING = 95_000;
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
  /** The first record of an account also creates its `record_counts` row. */
  recordCreateFirst: number;
  recordCreate: number;
  recordPut: number;
  recordDelete: number;
  /** A `record_counts` row, removed when its account is deleted. */
  countsInsert: number;
  /** The tombstone a deleted account leaves so its id is never used again. */
  tombstoneInsert: number;
  /** Rows of one record removed by the purge of a deleted account. */
  recordPurge: number;
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
  // The statements of a push, as the route runs them.
  const blob = 'A'.repeat(40);
  const record = (sql: string, id: string, ...rest: unknown[]) =>
    written(db.prepare(sql).bind('measured', id, 'item', ...rest));
  const first = crypto.randomUUID();
  const recordCreateFirst = await record(CREATE, first, blob, 30, 0);
  const recordCreate = await record(CREATE, crypto.randomUUID(), blob, 30, 0);
  const recordPut = await record(PUT, first, 'B'.repeat(40), 30, 1);
  const recordDelete = await record(DELETE, first, 2);
  await db
    .prepare(
      `INSERT INTO users (id, email, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism,
           login_key_hash, recovery_key_hash, wrapped_data_key, recovery_wrapped_data_key,
           created_at, updated_at)
         VALUES ('other', 'other@example.com', 's', 1, 1, 1, 'l', 'r', 'w', 'rw', 0, 0)`,
    )
    .run();
  const countsInsert = await written(
    db.prepare("INSERT INTO record_counts (user_id, records, bytes) VALUES ('other', 0, 0)"),
  );
  const tombstoneInsert = await written(
    db.prepare("INSERT INTO deleted_users (id) VALUES ('never-used')"),
  );
  // Deleting the account as the route does; its sessions are already gone.
  const accountDelete = (
    await db.batch(DELETE_ACCOUNT_STATEMENTS.map((sql) => db.prepare(sql).bind('measured')))
  ).reduce((sum, result) => sum + result.meta.rows_written, 0);
  const purge = meteredDb(db);
  await sweepExpiredRows(purge.db, 0, 1, 1);
  const recordPurge = purge.written();
  return {
    counterInsert,
    counterUpdate,
    sessionInsert,
    userInsert,
    userUpdate,
    recordCreateFirst,
    recordCreate,
    recordPut,
    recordDelete,
    countsInsert,
    tombstoneInsert,
    recordPurge,
    deletesWithinInserts:
      counterDelete <= counterInsert &&
      sessionDelete <= sessionInsert &&
      accountDelete <= userInsert + countsInsert + tombstoneInsert &&
      recordPurge <= recordCreate,
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
    // Password change rewrites the user; account deletion removes it, its counts row and
    // leaves a tombstone. The removed rows are charged like their insertion.
    proof:
      base('proof') +
      Math.max(costs.userUpdate, costs.userInsert + costs.countsInsert + costs.tombstoneInsert),
    extract: 0,
    recordsPull: base('recordsPull'),
    // A full push of the costliest operation, one of them the first record of the account.
    recordsPush:
      base('recordsPush') +
      MAX_PUSH_RECORDS * Math.max(costs.recordCreate, costs.recordPut, costs.recordDelete) +
      (costs.recordCreateFirst - costs.recordCreate),
  };
}

/**
 * Whether the weight a push is counted with covers every row it can write: its own counters,
 * each operation (a put may insert a new record) and the first record of an account.
 */
function weightsCoverRows(costs: Costs): boolean {
  return (
    PUSH_REQUEST_ROWS >= counterRows(costs, everyRequest('recordsPush')) &&
    OPERATION_ROWS.create >= costs.recordCreate &&
    OPERATION_ROWS.put >= Math.max(costs.recordCreate, costs.recordPut) &&
    OPERATION_ROWS.delete >= costs.recordDelete &&
    FIRST_RECORD_ROWS >= costs.recordCreateFirst - costs.recordCreate
  );
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
  // Sync keys are charged as new on every request, like the account actions. A push is counted
  // by its weight, which covers the rows it writes, so its global cap is already in rows.
  const pull = perDay(LIMITS.recordsPull.global) * rows.recordsPull;
  const push = perDay(LIMITS.recordsPush.global);
  // The daily sweep purges the records of deleted accounts, written on earlier days.
  const purge = PURGE_MAX_RECORDS * costs.recordCreate;
  return { rows, auth, extract, pull, push, purge, total: auth + extract + pull + push + purge };
}

describe('daily D1 write budget', () => {
  it('should account for every rate limited action', () => {
    const modelled: Action[] = [
      'register',
      'login',
      'recovery',
      'proof',
      'extract',
      'recordsPull',
      'recordsPush',
    ];

    expect((Object.keys(LIMITS) as Action[]).sort()).toEqual([...modelled].sort());
  });

  it('should count the account actions in a daily budget', () => {
    expect({ windowMs: AUTH_BUDGET.windowMs, actions: [...BUDGETED_ACTIONS].sort() }).toEqual({
      windowMs: DAY,
      actions: ['login', 'proof', 'recovery', 'register'],
    });
  });

  it('should measure the rows of counters, sessions, users and records', async () => {
    const costs = await measure();

    expect(costs).toEqual({
      counterInsert: 1,
      counterUpdate: 1,
      sessionInsert: 2,
      userInsert: 3,
      userUpdate: 1,
      recordCreateFirst: 5,
      recordCreate: 4,
      recordPut: 3,
      recordDelete: 3,
      countsInsert: 2,
      tombstoneInsert: 1,
      recordPurge: 1,
      deletesWithinInserts: true,
    });
  });

  it('should count a push by a weight that covers every row it writes', async () => {
    expect(weightsCoverRows(await measure())).toBe(true);
  });

  it('should keep the worst day of abuse under the ceiling', async () => {
    const worst = worstCase(await measure());

    expect({ ...worst, underCeiling: worst.total <= CEILING && CEILING < D1_DAILY_WRITES }).toEqual(
      {
        rows: {
          register: 11,
          login: 8,
          recovery: 9,
          proof: 9,
          extract: 0,
          recordsPull: 3,
          recordsPush: 404,
        },
        auth: 45_200,
        extract: 12_000,
        pull: 9_000,
        push: 24_000,
        purge: 4_000,
        total: 94_200,
        underCeiling: true,
      },
    );
  });
});
