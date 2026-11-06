import { toBase64Url } from '@stash/core/protocol';
import { ApiError } from './errors';
import { hmac } from './hashing';

/** At most `max` requests per `windowMs`, in fixed windows. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Limits per action. Each request counts against every bucket of its action: the global one
 * (a ceiling across all clients), the client's IP and, where it applies, the email or account.
 * Counters live in D1 because the Workers rate limiting binding is approximate, per location
 * and may not be available on the Free plan.
 */
export const LIMITS = {
  register: { global: { max: 300, windowMs: HOUR }, ip: { max: 5, windowMs: HOUR } },
  prelogin: {
    global: { max: 3000, windowMs: 10 * MINUTE },
    ip: { max: 30, windowMs: 10 * MINUTE },
  },
  login: {
    global: { max: 3000, windowMs: 10 * MINUTE },
    ip: { max: 20, windowMs: 10 * MINUTE },
    email: { max: 10, windowMs: 10 * MINUTE },
  },
  recovery: {
    global: { max: 300, windowMs: HOUR },
    ip: { max: 10, windowMs: HOUR },
    email: { max: 5, windowMs: HOUR },
  },
  /** Authenticated actions that take a login key as proof: password change, upgrade, delete. */
  proof: { account: { max: 10, windowMs: HOUR } },
} as const satisfies Record<string, Partial<Record<Bucket, Limit>>>;

export type Action = keyof typeof LIMITS;
type Bucket = 'global' | 'ip' | 'email' | 'account';

/** Rows older than the longest window are dead and can be deleted. */
export const LONGEST_WINDOW_MS = HOUR;

/** The values a request is counted under; the global bucket needs none. */
export interface Subjects {
  readonly ip?: string;
  readonly email?: string;
  readonly account?: string;
}

const HIT = `
INSERT INTO rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN 1 ELSE rate_limits.count + 1 END,
  window_start = CASE WHEN rate_limits.window_start <= ?2 - ?3 THEN ?2 ELSE rate_limits.window_start END
RETURNING count, window_start`;

/**
 * Counts the request in every bucket of the action in one atomic batch, before any other work,
 * and throws a 429 when any bucket is over its limit. Subjects are stored as HMACs.
 */
export async function enforceRateLimit(
  db: D1Database,
  pepper: string,
  action: Action,
  subjects: Subjects,
  now = Date.now(),
): Promise<void> {
  const limits: Partial<Record<Bucket, Limit>> = LIMITS[action];
  const buckets: { limit: Limit; key: string }[] = [];
  for (const [bucket, limit] of Object.entries(limits) as [Bucket, Limit][]) {
    const subject = bucket === 'global' ? '' : subjects[bucket];
    if (subject === undefined) continue;
    const digest = await hmac(pepper, 'rate-limit', `${action}\u0000${bucket}\u0000${subject}`);
    buckets.push({ limit, key: toBase64Url(digest) });
  }

  const results = await db.batch<{ count: number; window_start: number }>(
    buckets.map(({ limit, key }) => db.prepare(HIT).bind(key, now, limit.windowMs)),
  );

  let retryAfterMs = 0;
  results.forEach((result, index) => {
    const row = result.results[0];
    const { limit } = buckets[index] as { limit: Limit };
    if (row !== undefined && row.count > limit.max) {
      retryAfterMs = Math.max(retryAfterMs, row.window_start + limit.windowMs - now);
    }
  });
  if (retryAfterMs > 0) {
    throw new ApiError('RATE_LIMITED', 'Too many requests, try again later', 429, {
      'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
    });
  }
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
