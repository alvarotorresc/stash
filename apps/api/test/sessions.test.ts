import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { SESSION_TTL_MS, resolveSessionFromRequest } from '../src/accounts/sessions';
import { BASE_URL, call, dataOf, errorOf, login, randomKey, register } from './helpers';

function requestWith(authorization?: string): Request {
  const headers = authorization === undefined ? undefined : { Authorization: authorization };
  return new Request(`${BASE_URL}/api/anything`, { headers });
}

describe('resolveSessionFromRequest', () => {
  it('should return the account behind a valid bearer token', async () => {
    const { token, session } = await register();
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;

    const resolved = await resolveSessionFromRequest(requestWith(`Bearer ${token}`), env);

    expect({ userId: resolved?.userId, expiresAt: resolved?.expiresAt }).toEqual({
      userId,
      expiresAt: session.expiresAt,
    });
  });

  it.each([
    ['no header', undefined],
    ['another scheme', `Basic ${randomKey()}`],
    ['a token of the wrong length', `Bearer ${randomKey(16)}`],
    ['a token outside base64url', `Bearer ${'+'.repeat(43)}`],
    ['a non-canonical token', `Bearer ${'A'.repeat(42)}B`],
    ['an unknown token', `Bearer ${randomKey()}`],
  ])('should return null for %s', async (_case, header) => {
    await register();

    expect(await resolveSessionFromRequest(requestWith(header), env)).toBeNull();
  });

  it('should return null once the session has expired', async () => {
    const { token, session } = await register();

    const resolved = await resolveSessionFromRequest(
      requestWith(`Bearer ${token}`),
      env,
      session.expiresAt,
    );

    expect(resolved).toBeNull();
  });

  it('should store only a digest of the token', async () => {
    const { token } = await register();

    const rows = await env.DB.prepare('SELECT token_hash FROM sessions').all<{
      token_hash: string;
    }>();

    expect(rows.results.map((row) => row.token_hash === token)).toEqual([false]);
  });
});

describe('authenticated routes', () => {
  it('should answer 401 UNAUTHORIZED without a token', async () => {
    expect(await errorOf(await call(API_PATHS.account))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('should answer 401 for an expired session', async () => {
    const { token } = await register();
    await env.DB.prepare('UPDATE sessions SET expires_at = ?')
      .bind(Date.now() - 1)
      .run();

    expect(await errorOf(await call(API_PATHS.account, { token }))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('should set sessions to expire 30 days after they start', () => {
    expect(SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe('POST /api/auth/logout', () => {
  it('should close the session it is called with', async () => {
    const { token } = await register();

    await dataOf(await call(API_PATHS.logout, { method: 'POST', token }));
    const after = await call(API_PATHS.account, { token });

    expect(after.status).toBe(401);
  });

  it('should leave the other sessions of the account open', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);

    await dataOf(await call(API_PATHS.logout, { method: 'POST', token }));
    const after = await call(API_PATHS.account, { token: other });

    expect(after.status).toBe(200);
  });

  it('should answer 401 without a session', async () => {
    expect(await errorOf(await call(API_PATHS.logout, { method: 'POST' }))).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });
});
