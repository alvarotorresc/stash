import { env } from 'cloudflare:workers';
import {
  API_PATHS,
  DEFAULT_KDF_PARAMS,
  type AccountResponse,
  type KdfParams,
} from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import {
  accountSetup,
  call,
  dataOf,
  errorOf,
  login,
  passwordSetup,
  randomKey,
  register,
} from './helpers';

function replace(path: string, token: string, currentLoginKey: string, keys: object) {
  return call(path, { method: 'PUT', token, body: { currentLoginKey, keys } });
}

function loginStatus(email: string, loginKey: string): Promise<number> {
  return call(API_PATHS.login, { body: { email, loginKey } }).then((res) => res.status);
}

describe('PUT /api/account/password', () => {
  it('should replace the password setup and switch the login key', async () => {
    const { email, keys, token } = await register();
    const next = passwordSetup();

    await dataOf(await replace(API_PATHS.password, token, keys.loginKey, next));
    const me = await dataOf<AccountResponse>(await call(API_PATHS.account, { token }));

    expect({
      salt: me.salt,
      wrapped: me.wrappedDataKey,
      newLogin: await loginStatus(email, next.loginKey),
      oldLogin: await loginStatus(email, keys.loginKey),
    }).toEqual({ salt: next.salt, wrapped: next.wrappedDataKey, newLogin: 200, oldLogin: 401 });
  });

  it('should keep the current session and close every other one', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);

    await dataOf(await replace(API_PATHS.password, token, keys.loginKey, passwordSetup()));

    expect({
      current: (await call(API_PATHS.account, { token })).status,
      other: (await call(API_PATHS.account, { token: other })).status,
    }).toEqual({ current: 200, other: 401 });
  });

  it('should keep the recovery setup', async () => {
    const { keys, token } = await register();
    const before = await env.DB.prepare('SELECT recovery_key_hash FROM users').first();

    await dataOf(await replace(API_PATHS.password, token, keys.loginKey, passwordSetup()));
    const after = await env.DB.prepare('SELECT recovery_key_hash FROM users').first();

    expect(after).toEqual(before);
  });

  it('should answer 403 INVALID_CREDENTIALS and change nothing for a wrong current key', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);

    const res = await replace(API_PATHS.password, token, randomKey(), passwordSetup());

    expect({
      error: await errorOf(res),
      login: await loginStatus(email, keys.loginKey),
      other: (await call(API_PATHS.account, { token: other })).status,
    }).toEqual({ error: { status: 403, code: 'INVALID_CREDENTIALS' }, login: 200, other: 200 });
  });

  it('should only ever change the account of the session', async () => {
    const a = await register();
    const b = await register();

    // A proves with B's key: rejected, and B is untouched.
    const res = await replace(API_PATHS.password, a.token, b.keys.loginKey, passwordSetup());

    expect({
      status: res.status,
      a: await loginStatus(a.email, a.keys.loginKey),
      b: await loginStatus(b.email, b.keys.loginKey),
    }).toEqual({ status: 403, a: 200, b: 200 });
  });

  it('should answer 401 without a session', async () => {
    const { keys } = await register();

    const res = await call(API_PATHS.password, {
      method: 'PUT',
      body: { currentLoginKey: keys.loginKey, keys: passwordSetup() },
    });

    expect(res.status).toBe(401);
  });

  it('should answer 400 for an invalid new setup', async () => {
    const { keys, token } = await register();

    const res = await replace(API_PATHS.password, token, keys.loginKey, { salt: 'x' });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('should answer 401 when the account behind the session is gone', async () => {
    const { keys, token } = await register();
    await env.DB.prepare('PRAGMA foreign_keys = OFF').run();
    await env.DB.prepare('DELETE FROM users').run();

    const res = await replace(API_PATHS.password, token, keys.loginKey, passwordSetup());

    expect(res.status).toBe(401);
  });
});

describe('PUT /api/account/kdf', () => {
  const STRONGER: KdfParams = {
    ...DEFAULT_KDF_PARAMS,
    iterations: DEFAULT_KDF_PARAMS.iterations + 1,
  };

  it('should accept stronger parameters and keep every session open', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);
    const upgrade = passwordSetup(STRONGER);

    await dataOf(await replace(API_PATHS.kdf, token, keys.loginKey, upgrade));

    expect({
      kdf: (await dataOf<AccountResponse>(await call(API_PATHS.account, { token }))).kdf,
      other: (await call(API_PATHS.account, { token: other })).status,
      login: await loginStatus(email, upgrade.loginKey),
    }).toEqual({ kdf: STRONGER, other: 200, login: 200 });
  });

  it.each([
    ['equal', STRONGER],
    ['weaker', DEFAULT_KDF_PARAMS],
    [
      'more memory but fewer iterations',
      { ...STRONGER, memoryKiB: STRONGER.memoryKiB * 2, iterations: DEFAULT_KDF_PARAMS.iterations },
    ],
  ])('should answer 400 for %s parameters', async (_case, kdf) => {
    const keys = accountSetup(STRONGER);
    const { token } = await register(undefined, keys);

    const res = await replace(API_PATHS.kdf, token, keys.loginKey, passwordSetup(kdf));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('should answer 403 for a wrong current login key', async () => {
    const { token } = await register();

    const res = await replace(API_PATHS.kdf, token, randomKey(), passwordSetup(STRONGER));

    expect(await errorOf(res)).toEqual({ status: 403, code: 'INVALID_CREDENTIALS' });
  });
});
