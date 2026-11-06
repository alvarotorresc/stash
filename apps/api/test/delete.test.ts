import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import { RECORDS_PATH } from '@stash/core/sync-protocol';
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

  it('should delete the records of the account and their counts', async () => {
    const { keys, token } = await register();
    const other = await register();
    const operations = [
      { op: 'create', id: crypto.randomUUID(), kind: 'item', blob: randomKey(64) },
    ];
    await dataOf(await call(RECORDS_PATH, { method: 'POST', token, body: { operations } }));
    await dataOf(
      await call(RECORDS_PATH, { method: 'POST', token: other.token, body: { operations } }),
    );

    await dataOf(await deleteAccount(token, keys.loginKey));
    const left = await env.DB.prepare(
      `SELECT (SELECT count(*) FROM records) AS records,
              (SELECT count(*) FROM record_counts) AS counts`,
    ).first<{ records: number; counts: number }>();

    expect(left).toEqual({ records: 1, counts: 1 });
  });

  it('should delete the rate limit counters tied to the account', async () => {
    const { keys, token } = await register();
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;
    const counters = await accountCounterKeys(env.PEPPER, userId as string);
    // The sync counters exist before the deletion (the proof counter is the deletion itself).
    const operations = [
      { op: 'create', id: crypto.randomUUID(), kind: 'item', blob: randomKey(64) },
    ];
    await dataOf(await call(RECORDS_PATH, { method: 'POST', token, body: { operations } }));
    await dataOf(await call(RECORDS_PATH, { token }));
    const before = await env.DB.prepare(
      `SELECT count(*) AS n FROM rate_limits WHERE key IN (${counters.map(() => '?').join(', ')})`,
    )
      .bind(...counters)
      .first<{ n: number }>();

    await dataOf(await deleteAccount(token, keys.loginKey));
    const left = await env.DB.prepare(
      `SELECT count(*) AS n FROM rate_limits WHERE key IN (${counters.map(() => '?').join(', ')})`,
    )
      .bind(...counters)
      .first<{ n: number }>();

    expect({ tracked: counters.length, before: before?.n, left: left?.n }).toEqual({
      tracked: 4,
      before: 2,
      left: 0,
    });
  });

  it('should delete the failed attempt counters of its email', async () => {
    const { email, keys, token } = await register();
    await call(API_PATHS.login, { body: { email, loginKey: randomKey() } });
    await call(API_PATHS.recoveryStart, { body: { email, recoveryAuthKey: randomKey() } });
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;
    const all = await accountCounterKeys(env.PEPPER, userId as string, email);
    const byEmail = all.slice((await accountCounterKeys(env.PEPPER, userId as string)).length);
    const count = () =>
      env.DB.prepare(
        `SELECT count(*) AS n FROM rate_limits WHERE key IN (${byEmail.map(() => '?').join(', ')})`,
      )
        .bind(...byEmail)
        .first<{ n: number }>()
        .then((row) => row?.n);
    const before = await count();

    await dataOf(await deleteAccount(token, keys.loginKey));

    expect({ before, after: await count() }).toEqual({ before: 2, after: 0 });
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
