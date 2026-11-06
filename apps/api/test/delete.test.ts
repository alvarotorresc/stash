import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { accountCounterKeys } from '../src/accounts/rate-limit';
import { call, dataOf, errorOf, login, randomKey, register } from './helpers';

function deleteAccount(token: string | undefined, loginKey: string): Promise<Response> {
  return call(API_PATHS.account, { method: 'DELETE', token, body: { loginKey } });
}

async function rowsOf(email: string): Promise<{ users: number; sessions: number }> {
  const users = await env.DB.prepare('SELECT count(*) AS n FROM users WHERE email = ?')
    .bind(email)
    .first<{ n: number }>();
  const sessions = await env.DB.prepare(
    'SELECT count(*) AS n FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)',
  )
    .bind(email)
    .first<{ n: number }>();
  return { users: users?.n ?? -1, sessions: sessions?.n ?? -1 };
}

describe('DELETE /api/account', () => {
  it('should delete the account and every session it had', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);

    await dataOf(await deleteAccount(token, keys.loginKey));
    const sessions = await env.DB.prepare('SELECT count(*) AS n FROM sessions').first<{
      n: number;
    }>();

    expect({
      rows: await rowsOf(email),
      sessions: sessions?.n,
      token: (await call(API_PATHS.account, { token })).status,
      other: (await call(API_PATHS.account, { token: other })).status,
      login: (await call(API_PATHS.login, { body: { email, loginKey: keys.loginKey } })).status,
    }).toEqual({
      rows: { users: 0, sessions: 0 },
      sessions: 0,
      token: 401,
      other: 401,
      login: 401,
    });
  });

  it('should delete the rate limit counters tied to the account', async () => {
    const { keys, token } = await register();
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;
    const counters = await accountCounterKeys(env.PEPPER, userId as string);

    await dataOf(await deleteAccount(token, keys.loginKey));
    const left = await env.DB.prepare(
      `SELECT count(*) AS n FROM rate_limits WHERE key IN (${counters.map(() => '?').join(', ')})`,
    )
      .bind(...counters)
      .first<{ n: number }>();

    expect({ tracked: counters.length, left: left?.n }).toEqual({ tracked: 3, left: 0 });
  });

  it('should free the email for a new registration', async () => {
    const { email, keys, token } = await register();

    await dataOf(await deleteAccount(token, keys.loginKey));
    const again = await register(email);

    expect(again.email).toBe(email);
  });

  it('should leave other accounts untouched', async () => {
    const a = await register();
    const b = await register();

    await dataOf(await deleteAccount(a.token, a.keys.loginKey));

    expect({
      rows: await rowsOf(b.email),
      session: (await call(API_PATHS.account, { token: b.token })).status,
    }).toEqual({ rows: { users: 1, sessions: 1 }, session: 200 });
  });

  it('should answer 403 and delete nothing for a wrong login key', async () => {
    const { email, token } = await register();

    const res = await deleteAccount(token, randomKey());

    expect({ error: await errorOf(res), rows: await rowsOf(email) }).toEqual({
      error: { status: 403, code: 'INVALID_CREDENTIALS' },
      rows: { users: 1, sessions: 1 },
    });
  });

  it("should not delete another account with that account's login key", async () => {
    const a = await register();
    const b = await register();

    const res = await deleteAccount(a.token, b.keys.loginKey);

    expect({ status: res.status, a: await rowsOf(a.email), b: await rowsOf(b.email) }).toEqual({
      status: 403,
      a: { users: 1, sessions: 1 },
      b: { users: 1, sessions: 1 },
    });
  });

  it('should answer 401 without a session', async () => {
    const { keys } = await register();

    expect((await deleteAccount(undefined, keys.loginKey)).status).toBe(401);
  });
});
