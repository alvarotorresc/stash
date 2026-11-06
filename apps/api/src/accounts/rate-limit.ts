import { toBase64Url } from '@stash/core/protocol';
import type { RateLimiter } from '../rate-limit';
import { ApiError } from './errors';
import { hmac } from './hashing';

/** At most `max` requests (or units of cost) per `windowMs`, in fixed windows. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Buckets, from the most specific to the most general, which is also the order they are
 * evaluated in:
 *
 * - `ip`: the client's IP (IPv6 cut to its /64).
 * - `account`: the account of the session.
 * - `failedEmailIp`, `failedEmail`: failed attempts only, for one email from one IP and for one
 *   email from anywhere. Counting only failures keeps anyone from locking an owner out with
 *   their right password, and the per-IP bucket makes a targeted lockout need many IPs.
 * - `global`: every client together, a ceiling for the action.
 */
type Bucket = 'ip' | 'account' | 'failedEmailIp' | 'failedEmail' | 'global';
const ORDER: readonly Bucket[] = ['ip', 'account', 'failedEmailIp', 'failedEmail', 'global'];
const FAILURES_ONLY: ReadonlySet<Bucket> = new Set(['failedEmailIp', 'failedEmail']);

/**
 * Limits per action. Counters live in D1 because the Workers rate limiting binding is
 * approximate, per location and may not be available on the Free plan. Each counted bucket
 * costs one written row, and D1 stops answering every query once the daily quota of written
 * rows is spent, so the caps here are sized against that quota (see the README and
 * `test/write-budget.test.ts`, which fails when a cap is raised past it). The salt step of the
 * login is not counted in D1: it protects no secret and is left to a WAF rule.
 */
export const LIMITS = {
  register: { ip: { max: 5, windowMs: HOUR }, global: { max: 100, windowMs: DAY } },
  login: {
    ip: { max: 20, windowMs: 10 * MINUTE },
    failedEmailIp: { max: 5, windowMs: 10 * MINUTE },
    failedEmail: { max: 50, windowMs: HOUR },
    global: { max: 3000, windowMs: 10 * MINUTE },
  },
  recovery: {
    ip: { max: 10, windowMs: HOUR },
    failedEmailIp: { max: 5, windowMs: HOUR },
    failedEmail: { max: 20, windowMs: HOUR },
    global: { max: 300, windowMs: HOUR },
  },
  /** Actions proven with the login key: both password change steps, upgrade and deletion. */
  proof: { account: { max: 10, windowMs: HOUR } },
  /**
   * Extraction proxy, per account, with a daily global cap well under the Workers request quota
   * and the D1 write quota, so a burst of accounts cannot starve every other route.
   */
  extract: { account: { max: 60, windowMs: 10 * MINUTE }, global: { max: 6000, windowMs: DAY } },
  /**
   * Record sync, split by cost. A pull only writes its counters and is counted as one request;
   * a first load of a full account fits in the pull limits. A push is counted by its weight,
   * the rows it can write (see `src/records/weight.ts`), so these caps are in written rows: a
   * day of one account stays a fraction of the global cap, which bounds every record write.
   */
  recordsPull: {
    account: { max: 300, windowMs: 10 * MINUTE },
    global: { max: 3000, windowMs: DAY },
  },
  recordsPush: {
    account: { max: 6000, windowMs: DAY },
    global: { max: 24_000, windowMs: DAY },
  },
} as const satisfies Record<string, Partial<Record<Bucket, Limit>>>;

export type Action = keyof typeof LIMITS;

/**
 * Daily budget shared by every account action counted in D1. It is the most general bucket and
 * is counted last, only when every other bucket of the request has room. Spent, nobody can
 * register, log in or recover until the window ends, but open sessions keep working.
 */
export const AUTH_BUDGET: Limit = { max: 5000, windowMs: DAY };
export const BUDGETED_ACTIONS: ReadonlySet<Action> = new Set([
  'register',
  'login',
  'recovery',
  'proof',
]);

/** Rows older than the longest window are dead and can be deleted. */
export const LONGEST_WINDOW_MS = DAY;

/** The values a request is counted under; the global buckets need none. */
export interface Subjects {
  readonly ip?: string;
  readonly email?: string;
  readonly account?: string;
}

interface Counter {
  readonly bucket: Bucket;
  readonly key: string;
  readonly limit: Limit;
  /** What one request adds to the bucket: its cost, or 1 for a failure bucket. */
  readonly cost: number;
}

/**
 * Adds a request's cost (?5) to a bucket, unless that would take it over its max: then it writes
 * nothing and returns no row. A window that has passed starts again at the cost. A cost over the
 * max is refused before any write, also for a new key or a passed window, by the `SELECT`.
 */
const HIT = `
INSERT INTO rate_limits (key, window_start, count) SELECT ?1, ?2, ?5 WHERE ?5 <= ?4
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?5 ELSE rate_limits.count + ?5 END,
  window_start = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limits.window_start END
WHERE rate_limits.window_start <= ?2 - ?3 OR rate_limits.count + ?5 <= ?4
RETURNING count`;

function subjectOf(bucket: Bucket, { ip, email, account }: Subjects): string | undefined {
  switch (bucket) {
    case 'ip':
      return ip;
    case 'account':
      return account;
    case 'failedEmail':
      return email;
    case 'failedEmailIp':
      return email === undefined || ip === undefined ? undefined : `${email}\u0000${ip}`;
    case 'global':
      return '';
  }
}

/**
 * The counters of a request, most specific first, with the shared budget last. Counted buckets
 * take the request's cost; failure buckets count one failure at a time.
 */
async function countersOf(
  pepper: string,
  action: Action,
  subjects: Subjects,
  cost = 1,
): Promise<Counter[]> {
  const limits: Partial<Record<Bucket, Limit>> = LIMITS[action];
  const counters: Counter[] = [];
  for (const bucket of ORDER) {
    const limit = limits[bucket];
    const subject = subjectOf(bucket, subjects);
    if (limit === undefined || subject === undefined) continue;
    counters.push({
      bucket,
      limit,
      key: await counterKey(pepper, action, bucket, subject),
      cost: FAILURES_ONLY.has(bucket) ? 1 : cost,
    });
  }
  if (BUDGETED_ACTIONS.has(action)) {
    counters.push({
      bucket: 'global',
      limit: AUTH_BUDGET,
      key: await counterKey(pepper, 'auth', 'global', ''),
      cost,
    });
  }
  return counters;
}

/**
 * How long until every counter has room for its cost again, 0 when all have. A cost over a
 * bucket's max never fits: it waits a whole window. Reads only.
 */
async function waitFor(db: D1Database, counters: Counter[], now: number): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT key, window_start, count FROM rate_limits WHERE key IN (${counters.map(() => '?').join(', ')})`,
    )
    .bind(...counters.map(({ key }) => key))
    .all<{ key: string; window_start: number; count: number }>();
  let wait = 0;
  for (const { limit, cost } of counters) {
    if (cost > limit.max) wait = Math.max(wait, limit.windowMs);
  }
  for (const row of results) {
    const { limit, cost } = counters.find(({ key }) => key === row.key) as Counter;
    const endsAt = row.window_start + limit.windowMs;
    if (endsAt > now && row.count + cost > limit.max) wait = Math.max(wait, endsAt - now);
  }
  return wait;
}

/** Adds each counter's cost; returns the counters that had no room and wrote nothing. */
async function hit(db: D1Database, counters: Counter[], now: number): Promise<Counter[]> {
  if (counters.length === 0) return [];
  const results = await db.batch<{ count: number }>(
    counters.map(({ key, limit, cost }) =>
      db.prepare(HIT).bind(key, now, limit.windowMs, limit.max, cost),
    ),
  );
  return counters.filter((_, index) => results[index]?.results.length === 0);
}

/**
 * Counts the request and returns how long to wait when a bucket is full, or 0 when it may go
 * ahead. A request has a cost, 1 by default: it adds that much to each bucket and is refused
 * when any bucket would go over its max. A refused request writes no row:
 *
 * 1. Every bucket, failure buckets included, is read; any without room refuses the request.
 * 2. The specific buckets (IP, account) are counted with a conditional upsert.
 * 3. Only if all of them had room, the global bucket and the shared budget are counted.
 *
 * So one client over its own limit never fills the buckets every other client shares, not even
 * with concurrent requests that all pass the read. Subjects are stored as HMACs.
 */
export async function countRequest(
  db: D1Database,
  pepper: string,
  action: Action,
  subjects: Subjects,
  now = Date.now(),
  cost = 1,
): Promise<number> {
  if (!Number.isSafeInteger(cost) || cost < 1) {
    throw new RangeError('The cost of a request must be a positive integer');
  }
  const counters = await countersOf(pepper, action, subjects, cost);
  const wait = await waitFor(db, counters, now);
  if (wait > 0) return wait;

  const counted = counters.filter(({ bucket }) => !FAILURES_ONLY.has(bucket));
  const specific = counted.filter(({ bucket }) => bucket !== 'global');
  const general = counted.filter(({ bucket }) => bucket === 'global');
  const full = await hit(db, specific, now);
  if (full.length === 0) full.push(...(await hit(db, general, now)));
  // Filled by a concurrent request between the read and the write.
  if (full.length > 0) return Math.max(await waitFor(db, full, now), 1000);
  return 0;
}

/**
 * Counts a failed attempt (a wrong login key or recovery key) in the failure buckets of the
 * action. A full bucket writes nothing.
 */
export async function recordFailure(
  db: D1Database,
  pepper: string,
  action: Action,
  subjects: Subjects,
  now = Date.now(),
): Promise<void> {
  const counters = await countersOf(pepper, action, subjects);
  await hit(
    db,
    counters.filter(({ bucket }) => FAILURES_ONLY.has(bucket)),
    now,
  );
}

/** Counts the request before any other work and throws a 429 with Retry-After when over. */
export async function enforceRateLimit(
  db: D1Database,
  pepper: string,
  action: Action,
  subjects: Subjects,
  now = Date.now(),
  cost = 1,
): Promise<void> {
  const retryAfterMs = await countRequest(db, pepper, action, subjects, now, cost);
  if (retryAfterMs > 0) {
    throw new ApiError('RATE_LIMITED', 'Too many requests, try again later', 429, {
      'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
    });
  }
}

function counterKey(pepper: string, action: Action | 'auth', bucket: Bucket, subject: string) {
  return hmac(pepper, 'rate-limit', `${action}\u0000${bucket}\u0000${subject}`).then(toBase64Url);
}

/**
 * Keys of every counter tied to an account, so deleting the account can remove them: its
 * per-account counters and, given its email, the failure counters of that email.
 */
export async function accountCounterKeys(
  pepper: string,
  accountId: string,
  email?: string,
): Promise<string[]> {
  const actions = Object.keys(LIMITS) as Action[];
  const limits = (action: Action): Partial<Record<Bucket, Limit>> => LIMITS[action];
  const keys = actions
    .filter((action) => limits(action).account !== undefined)
    .map((action) => counterKey(pepper, action, 'account', accountId));
  if (email !== undefined) {
    for (const action of actions.filter((action) => limits(action).failedEmail !== undefined)) {
      keys.push(counterKey(pepper, action, 'failedEmail', email));
    }
  }
  return Promise.all(keys);
}

/** The extraction limits as a `RateLimiter`, keyed by account id, counted in D1. */
export function createExtractRateLimiter(db: D1Database, pepper: string): RateLimiter {
  return {
    async limit({ key }) {
      return { success: (await countRequest(db, pepper, 'extract', { account: key })) === 0 };
    },
  };
}

/**
 * The client's IP from Cloudflare's `CF-Connecting-IP`. IPv6 addresses are cut to their /64,
 * the block a single client usually controls.
 */
export function clientIp(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP')?.trim();
  if (!ip) return 'unknown';
  // IPv4, or IPv4-mapped IPv6 such as ::ffff:192.0.2.1: kept whole.
  if (!ip.includes(':') || ip.includes('.')) return ip;
  return `${ipv6Prefix64(ip)}::/64`;
}

/** First four hextets of an IPv6 address, expanding `::`. Anything unparsable is kept as is. */
function ipv6Prefix64(ip: string): string {
  const address = ip.toLowerCase().split('%')[0] as string;
  const [head = '', tail] = address.split('::');
  const headParts = head === '' ? [] : head.split(':');
  const tailParts = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - headParts.length - tailParts.length;
  const parts =
    tail === undefined
      ? headParts
      : [...headParts, ...Array<string>(missing).fill('0'), ...tailParts];
  return parts
    .slice(0, 4)
    .map((part) => part.replace(/^0+(?=.)/, ''))
    .join(':');
}
