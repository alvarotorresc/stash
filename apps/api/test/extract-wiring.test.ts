import { env } from 'cloudflare:workers';
import { API_PATHS, toBase64Url } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { hmac } from '../src/accounts/hashing';
import { LIMITS } from '../src/accounts/rate-limit';
import { call, errorOf, register } from './helpers';

// A body the route rejects after the session and the rate limit, so nothing is fetched.
const INVALID_BODY = { url: 'not a url' };

function extract(token?: string): Promise<Response> {
  return call('/api/extract', { method: 'POST', token, body: INVALID_BODY });
}

/** Guards the production wiring of /api/extract: real sessions and real rate limits. */
function extractImage(token?: string): Promise<Response> {
  return call('/api/extract/image', { method: 'POST', token, body: INVALID_BODY });
}

describe('/api/extract in production wiring', () => {
  it('should answer 401 without a session', async () => {
    expect(await errorOf(await extract())).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('should accept a session opened by the account routes', async () => {
    const { token } = await register();

    expect((await extract(token)).status).toBe(400);
  });

  it('should answer 401 once the session is closed', async () => {
    const { token } = await register();
    await call(API_PATHS.logout, { method: 'POST', token });

    expect((await extract(token)).status).toBe(401);
  });

  it('should limit each account', async () => {
    const { token } = await register();
    for (let index = 0; index < LIMITS.extract.account.max; index++) await extract(token);

    const limited = await extract(token);
    const other = await register();

    expect({
      limited: await errorOf(limited),
      other: (await extract(other.token)).status,
    }).toEqual({ limited: { status: 429, code: 'RATE_LIMITED' }, other: 400 });
  });

  it('should apply the global cap across accounts', async () => {
    const { token } = await register();
    const key = toBase64Url(await hmac(env.PEPPER, 'rate-limit', 'extract\u0000global\u0000'));
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)')
      .bind(key, Date.now(), LIMITS.extract.global.max)
      .run();

    expect((await extract(token)).status).toBe(429);
  });

  it('should require a session for images too', async () => {
    expect(await errorOf(await extractImage())).toEqual({ status: 401, code: 'UNAUTHORIZED' });
  });

  it('should count images and pages in the same account limit', async () => {
    const { token } = await register();
    const half = LIMITS.extract.account.max / 2;
    for (let index = 0; index < half; index++) {
      await extract(token);
      await extractImage(token);
    }

    expect({
      page: await errorOf(await extract(token)),
      image: await errorOf(await extractImage(token)),
    }).toEqual({
      page: { status: 429, code: 'RATE_LIMITED' },
      image: { status: 429, code: 'RATE_LIMITED' },
    });
  });

  it('should count images in the global daily cap', async () => {
    const { token } = await register();
    const key = toBase64Url(await hmac(env.PEPPER, 'rate-limit', 'extract\u0000global\u0000'));
    await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)')
      .bind(key, Date.now(), LIMITS.extract.global.max)
      .run();

    expect((await extractImage(token)).status).toBe(429);
  });
});
