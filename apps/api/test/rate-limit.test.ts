import { env } from 'cloudflare:workers';
import { API_PATHS, toBase64Url } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { hmac } from '../src/accounts/hashing';
import {
  AUTH_BUDGET,
  LIMITS,
  clientIp,
  countRequest,
  createExtractRateLimiter,
  recordFailure,
} from '../src/accounts/rate-limit';
import {
  accountSetup,
  call,
  errorOf,
  passwordSetup,
  randomKey,
  register,
  uniqueEmail,
} from './helpers';
import { meteredDb } from './metered-db';

async function repeat(times: number, request: () => Promise<Response>): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < times; index++) statuses.push((await request()).status);
  return statuses;
}

function failedLogin(email: string, ip?: string): Promise<Response> {
  return call(API_PATHS.login, { ip, body: { email, loginKey: randomKey() } });
}

/** The stored key of a bucket without a subject: an action's global one or the auth budget. */
async function globalKey(action: string): Promise<string> {
  return toBase64Url(await hmac(env.PEPPER, 'rate-limit', `${action}\u0000global\u0000`));
}

async function countOf(key: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key = ?')
    .bind(key)
    .first<{ count: number }>();
  return row?.count ?? null;
}

async function fill(key: string, count: number): Promise<void> {
  await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)')
    .bind(key, Date.now(), count)
    .run();
}

describe('rate limiting', () => {
  it('should answer 429 RATE_LIMITED with Retry-After past the failed logins of an email from an IP', async () => {
    const email = uniqueEmail();
    const ip = '203.0.113.1';
    const { max, windowMs } = LIMITS.login.failedEmailIp;
    await repeat(max, () => failedLogin(email, ip));

    const res = await failedLogin(email, ip);
    const retryAfter = Number(res.headers.get('retry-after'));

    expect({
      error: await errorOf(res),
      retryAfter: retryAfter > 0 && retryAfter <= windowMs / 1000,
    }).toEqual({ error: { status: 429, code: 'RATE_LIMITED' }, retryAfter: true });
  });

  it('should limit the email the same way whether it has an account or not', async () => {
    const { email } = await register();
    const unknown = uniqueEmail();
    const max = LIMITS.login.failedEmailIp.max;

    const real = await repeat(max + 1, () => failedLogin(email, '203.0.113.2'));
    const fake = await repeat(max + 1, () => failedLogin(unknown, '203.0.113.3'));

    expect(fake).toEqual(real);
  });

  it('should block even the right key from an IP over its failed logins for the email', async () => {
    const { email, keys } = await register();
    const ip = '203.0.113.4';
    await repeat(LIMITS.login.failedEmailIp.max, () => failedLogin(email, ip));

    const res = await call(API_PATHS.login, { ip, body: { email, loginKey: keys.loginKey } });

    expect(res.status).toBe(429);
  });

  it('should let the owner log in from another IP while someone floods their email', async () => {
    const { email, keys } = await register();
    await repeat(LIMITS.login.failedEmailIp.max + 3, () => failedLogin(email, '203.0.113.5'));

    const res = await call(API_PATHS.login, {
      ip: '198.51.100.5',
      body: { email, loginKey: keys.loginKey },
    });

    expect(res.status).toBe(200);
  });

  it('should not count successful logins against the email', async () => {
    const { email, keys } = await register();
    const ip = '203.0.113.6';

    const statuses = await repeat(LIMITS.login.failedEmailIp.max + 1, () =>
      call(API_PATHS.login, { ip, body: { email, loginKey: keys.loginKey } }),
    );

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('should limit failed logins of an email across IPs', async () => {
    const email = uniqueEmail();
    await repeat(LIMITS.login.failedEmail.max, () => failedLogin(email));

    expect((await failedLogin(email)).status).toBe(429);
  });

  it('should limit login attempts per IP across emails', async () => {
    const ip = '203.0.113.7';
    await repeat(LIMITS.login.ip.max, () => failedLogin(uniqueEmail(), ip));

    expect((await failedLogin(uniqueEmail(), ip)).status).toBe(429);
  });

  it('should limit registrations per IP', async () => {
    const ip = '203.0.113.8';
    await repeat(LIMITS.register.ip.max, () =>
      call(API_PATHS.register, { ip, body: { email: uniqueEmail(), keys: accountSetup() } }),
    );

    const res = await call(API_PATHS.register, {
      ip,
      body: { email: uniqueEmail(), keys: accountSetup() },
    });

    expect(res.status).toBe(429);
  });

  it('should not count the salt step in D1', async () => {
    const ip = '203.0.113.9';

    const statuses = await repeat(40, () =>
      call(API_PATHS.prelogin, { ip, body: { email: uniqueEmail() } }),
    );
    const rows = await env.DB.prepare('SELECT count(*) AS n FROM rate_limits').first<{
      n: number;
    }>();

    expect({ ok: statuses.every((status) => status === 200), rows: rows?.n }).toEqual({
      ok: true,
      rows: 0,
    });
  });

  it('should limit failed recovery attempts of an email from an IP across both steps', async () => {
    const { email } = await register();
    const ip = '203.0.113.10';
    await repeat(LIMITS.recovery.failedEmailIp.max, () =>
      call(API_PATHS.recoveryStart, { ip, body: { email, recoveryAuthKey: randomKey() } }),
    );

    const res = await call(API_PATHS.recoveryComplete, {
      ip,
      body: { email, recoveryAuthKey: randomKey(), keys: accountSetup() },
    });

    expect(res.status).toBe(429);
  });

  it('should limit password proofs per account', async () => {
    const { token } = await register();
    await repeat(LIMITS.proof.account.max, () =>
      call(API_PATHS.password, {
        method: 'PUT',
        token,
        body: { currentLoginKey: randomKey(), keys: passwordSetup() },
      }),
    );

    const res = await call(API_PATHS.account, {
      method: 'DELETE',
      token,
      body: { loginKey: randomKey() },
    });

    expect(res.status).toBe(429);
  });

  it('should apply the global ceiling to every client', async () => {
    await fill(await globalKey('register'), LIMITS.register.global.max);

    const res = await call(API_PATHS.register, {
      body: { email: uniqueEmail(), keys: accountSetup() },
    });

    expect(res.status).toBe(429);
  });

  it('should share one daily budget between the account actions, but not extraction', async () => {
    await fill(await globalKey('auth'), AUTH_BUDGET.max);

    const statuses = {
      register: (
        await call(API_PATHS.register, { body: { email: uniqueEmail(), keys: accountSetup() } })
      ).status,
      login: (await failedLogin(uniqueEmail())).status,
      recovery: (
        await call(API_PATHS.recoveryStart, {
          body: { email: uniqueEmail(), recoveryAuthKey: randomKey() },
        })
      ).status,
      extract: (await createExtractRateLimiter(env.DB, env.PEPPER).limit({ key: 'account-x' }))
        .success,
    };

    expect(statuses).toEqual({
      register: 429,
      login: 429,
      recovery: 429,
      extract: true,
    });
  });

  it('should not count a request in the global bucket once its IP is over the limit', async () => {
    const ip = '203.0.113.11';
    const max = LIMITS.register.ip.max;
    await repeat(max + 5, () =>
      call(API_PATHS.register, { ip, body: { email: uniqueEmail(), keys: accountSetup() } }),
    );

    expect({
      global: await countOf(await globalKey('register')),
      budget: await countOf(await globalKey('auth')),
    }).toEqual({ global: max, budget: max });
  });

  it('should not let concurrent requests from one IP fill the global bucket', async () => {
    const ip = '203.0.113.12';
    const max = LIMITS.register.ip.max;

    await Promise.all(
      Array.from({ length: max * 4 }, () =>
        call(API_PATHS.register, { ip, body: { email: uniqueEmail(), keys: accountSetup() } }),
      ),
    );

    expect((await countOf(await globalKey('register'))) ?? 0).toBeLessThanOrEqual(max);
  });

  it('should not spend the budget on a request its action already refuses', async () => {
    await fill(await globalKey('register'), LIMITS.register.global.max);

    await call(API_PATHS.register, { body: { email: uniqueEmail(), keys: accountSetup() } });

    expect(await countOf(await globalKey('auth'))).toBeNull();
  });

  it('should start counting again once the window has passed', async () => {
    const email = uniqueEmail();
    const ip = '203.0.113.13';
    await repeat(LIMITS.login.failedEmailIp.max + 1, () => failedLogin(email, ip));
    await env.DB.prepare('UPDATE rate_limits SET window_start = ?')
      .bind(Date.now() - LIMITS.login.failedEmail.windowMs)
      .run();

    expect((await failedLogin(email, ip)).status).toBe(401);
  });

  it('should store neither emails nor IP addresses in clear', async () => {
    const email = uniqueEmail();
    const ip = '198.51.100.23';
    await failedLogin(email, ip);

    const rows = JSON.stringify(
      (await env.DB.prepare('SELECT key FROM rate_limits').all()).results,
    );

    expect([rows.includes(email), rows.includes(ip)]).toEqual([false, false]);
  });
});

describe('countRequest and recordFailure', () => {
  const subjects = { ip: '192.0.2.50', email: 'someone@example.com' };

  it('should write one row per bucket it counts', async () => {
    const metered = meteredDb(env.DB);

    await countRequest(metered.db, env.PEPPER, 'login', subjects);
    const counted = metered.written();
    await recordFailure(metered.db, env.PEPPER, 'login', subjects);

    // IP, global and budget on every attempt; email and (email, IP) on a failure.
    expect({ counted, failure: metered.written() - counted }).toEqual({ counted: 3, failure: 2 });
  });

  it('should write nothing for a request that a full bucket refuses', async () => {
    const ip = '192.0.2.51';
    for (let index = 0; index < LIMITS.login.ip.max; index++) {
      await countRequest(env.DB, env.PEPPER, 'login', { ip, email: `u${index}@example.com` });
    }
    const metered = meteredDb(env.DB);

    const wait = await countRequest(metered.db, env.PEPPER, 'login', {
      ip,
      email: 'next@example.com',
    });

    expect({ refused: wait > 0, written: metered.written() }).toEqual({
      refused: true,
      written: 0,
    });
  });

  it('should write nothing for a failure once its bucket is full', async () => {
    const failure = { ip: '192.0.2.52', email: 'full@example.com' };
    for (let index = 0; index < LIMITS.login.failedEmailIp.max; index++) {
      await recordFailure(env.DB, env.PEPPER, 'login', failure);
    }
    const metered = meteredDb(env.DB);

    await recordFailure(metered.db, env.PEPPER, 'login', { ...failure, ip: '192.0.2.53' });
    const firstFromNewIp = metered.written();
    await recordFailure(metered.db, env.PEPPER, 'login', failure);

    expect({ firstFromNewIp, again: metered.written() - firstFromNewIp }).toEqual({
      firstFromNewIp: 2,
      again: 1,
    });
  });

  it('should refuse a request whose bucket filled after the check, without a global count', async () => {
    // A stale read stands in for a concurrent request that filled the IP bucket meanwhile.
    const ip = '192.0.2.54';
    for (let index = 0; index < LIMITS.register.ip.max; index++) {
      await countRequest(env.DB, env.PEPPER, 'register', { ip });
    }
    const globalBefore = await countOf(await globalKey('register'));
    const stale = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'prepare') {
          return (sql: string) =>
            sql.startsWith('SELECT')
              ? { bind: () => ({ all: async () => ({ results: [] }) }) }
              : target.prepare(sql);
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
      },
    });

    const wait = await countRequest(stale, env.PEPPER, 'register', { ip });

    expect({
      wait: wait > 0 && wait <= LIMITS.register.ip.windowMs,
      global: await countOf(await globalKey('register')),
    }).toEqual({ wait: true, global: globalBefore });
  });
});

describe('clientIp', () => {
  function ipOf(header?: string): string {
    const headers = header === undefined ? undefined : { 'CF-Connecting-IP': header };
    return clientIp(new Request('https://stash.test', { headers }));
  }

  it.each([
    ['an IPv4 address whole', '192.0.2.1', '192.0.2.1'],
    ['an IPv6 address cut to its /64', '2001:db8:aa:bb:1:2:3:4', '2001:db8:aa:bb::/64'],
    ['a compressed IPv6 address', '2001:db8::1', '2001:db8:0:0::/64'],
    ['leading zeros and case', '2001:0DB8:00aa:0000::1', '2001:db8:aa:0::/64'],
    ['an address that starts with ::', '::1', '0:0:0:0::/64'],
    ['an IPv4-mapped address whole', '::ffff:192.0.2.1', '::ffff:192.0.2.1'],
    ['a zone index away', 'fe80::1%eth0', 'fe80:0:0:0::/64'],
  ])('should keep %s', (_case, header, expected) => {
    expect(ipOf(header)).toBe(expected);
  });

  it('should fall back to a shared bucket without the header', () => {
    expect(ipOf()).toBe('unknown');
  });
});

describe('createExtractRateLimiter', () => {
  it('should let an account through up to its limit and refuse it after', async () => {
    const limiter = createExtractRateLimiter(env.DB, env.PEPPER);
    const results: boolean[] = [];
    for (let index = 0; index <= LIMITS.extract.account.max; index++) {
      results.push((await limiter.limit({ key: 'account-a' })).success);
    }

    expect({
      allowed: results.filter(Boolean).length,
      last: results.at(-1),
      other: (await limiter.limit({ key: 'account-b' })).success,
    }).toEqual({ allowed: LIMITS.extract.account.max, last: false, other: true });
  });

  it('should not count an account over its limit in the global cap', async () => {
    const limiter = createExtractRateLimiter(env.DB, env.PEPPER);
    for (let index = 0; index < LIMITS.extract.account.max + 10; index++) {
      await limiter.limit({ key: 'account-c' });
    }

    expect(await countOf(await globalKey('extract'))).toBe(LIMITS.extract.account.max);
  });
});
