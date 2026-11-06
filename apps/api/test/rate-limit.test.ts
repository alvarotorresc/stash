import { env } from 'cloudflare:workers';
import { API_PATHS, toBase64Url } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { hmac } from '../src/accounts/hashing';
import { LIMITS, clientIp, createExtractRateLimiter } from '../src/accounts/rate-limit';
import {
  accountSetup,
  call,
  errorOf,
  passwordSetup,
  randomKey,
  register,
  uniqueEmail,
} from './helpers';

async function repeat(times: number, request: () => Promise<Response>): Promise<number[]> {
  const statuses: number[] = [];
  for (let index = 0; index < times; index++) statuses.push((await request()).status);
  return statuses;
}

describe('rate limiting', () => {
  it('should answer 429 RATE_LIMITED with Retry-After past the per-email login limit', async () => {
    const email = uniqueEmail();
    const max = LIMITS.login.email.max;
    await repeat(max, () => call(API_PATHS.login, { body: { email, loginKey: randomKey() } }));

    const res = await call(API_PATHS.login, { body: { email, loginKey: randomKey() } });
    const retryAfter = Number(res.headers.get('retry-after'));

    expect({ error: await errorOf(res), retryAfter: retryAfter > 0 && retryAfter <= 600 }).toEqual({
      error: { status: 429, code: 'RATE_LIMITED' },
      retryAfter: true,
    });
  });

  it('should limit the email the same way whether it has an account or not', async () => {
    const { email } = await register();
    const unknown = uniqueEmail();
    const max = LIMITS.login.email.max;

    const real = await repeat(max + 1, () =>
      call(API_PATHS.login, { body: { email, loginKey: randomKey() } }),
    );
    const fake = await repeat(max + 1, () =>
      call(API_PATHS.login, { body: { email: unknown, loginKey: randomKey() } }),
    );

    expect(fake).toEqual(real);
  });

  it('should block even the right key once the email is over its limit', async () => {
    const { email, keys } = await register();
    await repeat(LIMITS.login.email.max, () =>
      call(API_PATHS.login, { body: { email, loginKey: randomKey() } }),
    );

    const res = await call(API_PATHS.login, { body: { email, loginKey: keys.loginKey } });

    expect(res.status).toBe(429);
  });

  it('should limit login attempts per IP across emails', async () => {
    const ip = '203.0.113.7';
    await repeat(LIMITS.login.ip.max, () =>
      call(API_PATHS.login, { ip, body: { email: uniqueEmail(), loginKey: randomKey() } }),
    );

    const res = await call(API_PATHS.login, {
      ip,
      body: { email: uniqueEmail(), loginKey: randomKey() },
    });

    expect(res.status).toBe(429);
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

  it('should limit the salt step per IP', async () => {
    const ip = '203.0.113.9';
    await repeat(LIMITS.prelogin.ip.max, () =>
      call(API_PATHS.prelogin, { ip, body: { email: uniqueEmail() } }),
    );

    expect((await call(API_PATHS.prelogin, { ip, body: { email: uniqueEmail() } })).status).toBe(
      429,
    );
  });

  it('should limit recovery attempts per email across both steps', async () => {
    const { email } = await register();
    await repeat(LIMITS.recovery.email.max, () =>
      call(API_PATHS.recoveryStart, { body: { email, recoveryAuthKey: randomKey() } }),
    );

    const res = await call(API_PATHS.recoveryComplete, {
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
    const key = toBase64Url(await hmac(env.PEPPER, 'rate-limit', 'register\u0000global\u0000'));
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)')
      .bind(key, Date.now(), LIMITS.register.global.max)
      .run();

    const res = await call(API_PATHS.register, {
      body: { email: uniqueEmail(), keys: accountSetup() },
    });

    expect(res.status).toBe(429);
  });

  it('should start counting again once the window has passed', async () => {
    const email = uniqueEmail();
    await repeat(LIMITS.login.email.max + 1, () =>
      call(API_PATHS.login, { body: { email, loginKey: randomKey() } }),
    );
    await env.DB.prepare('UPDATE rate_limits SET window_start = ?')
      .bind(Date.now() - LIMITS.login.email.windowMs)
      .run();

    const res = await call(API_PATHS.login, { body: { email, loginKey: randomKey() } });

    expect(res.status).toBe(401);
  });

  it('should store neither emails nor IP addresses in clear', async () => {
    const email = uniqueEmail();
    const ip = '198.51.100.23';
    await call(API_PATHS.login, { ip, body: { email, loginKey: randomKey() } });

    const rows = JSON.stringify(
      (await env.DB.prepare('SELECT key FROM rate_limits').all()).results,
    );

    expect([rows.includes(email), rows.includes(ip)]).toEqual([false, false]);
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
});
