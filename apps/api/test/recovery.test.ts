import { env } from 'cloudflare:workers';
import {
  API_PATHS,
  type RecoveryCompleteResponse,
  type RecoveryStartResponse,
} from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import {
  accountSetup,
  call,
  dataOf,
  errorOf,
  login,
  randomKey,
  register,
  uniqueEmail,
} from './helpers';

function start(email: string, recoveryAuthKey: string): Promise<Response> {
  return call(API_PATHS.recoveryStart, { body: { email, recoveryAuthKey } });
}

function complete(email: string, recoveryAuthKey: string, keys = accountSetup()) {
  return call(API_PATHS.recoveryComplete, { body: { email, recoveryAuthKey, keys } });
}

describe('POST /api/auth/recovery/start', () => {
  it('should return the recovery-wrapped data key for the right recovery key', async () => {
    const { email, keys } = await register();

    const data = await dataOf<RecoveryStartResponse>(await start(email, keys.recoveryAuthKey));

    expect(data).toEqual({ recoveryWrappedDataKey: keys.recoveryWrappedDataKey });
  });

  it('should answer 401 INVALID_CREDENTIALS for a wrong recovery key', async () => {
    const { email } = await register();

    expect(await errorOf(await start(email, randomKey()))).toEqual({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('should answer an unknown email exactly like a wrong recovery key', async () => {
    const { email } = await register();

    const wrongKey = await start(email, randomKey());
    const unknown = await start(uniqueEmail(), randomKey());

    expect({ status: unknown.status, body: await unknown.text() }).toEqual({
      status: wrongKey.status,
      body: await wrongKey.text(),
    });
  });

  it('should not accept the login key as a recovery key', async () => {
    const { email, keys } = await register();

    expect((await start(email, keys.loginKey)).status).toBe(401);
  });
});

describe('POST /api/auth/recovery/complete', () => {
  it('should replace the password and recovery setup and open a new session', async () => {
    const { email, keys } = await register();
    const next = accountSetup();

    const { session } = await dataOf<RecoveryCompleteResponse>(
      await complete(email, keys.recoveryAuthKey, next),
    );

    expect({
      session: (await call(API_PATHS.account, { token: session.token })).status,
      newLogin: (await call(API_PATHS.login, { body: { email, loginKey: next.loginKey } })).status,
      oldLogin: (await call(API_PATHS.login, { body: { email, loginKey: keys.loginKey } })).status,
      oldCode: (await start(email, keys.recoveryAuthKey)).status,
      newCode: (await start(email, next.recoveryAuthKey)).status,
    }).toEqual({ session: 200, newLogin: 200, oldLogin: 401, oldCode: 401, newCode: 200 });
  });

  it('should close every session the account had', async () => {
    const { email, keys, token } = await register();
    const other = await login(email, keys.loginKey);

    await dataOf(await complete(email, keys.recoveryAuthKey));

    expect({
      first: (await call(API_PATHS.account, { token })).status,
      other: (await call(API_PATHS.account, { token: other })).status,
    }).toEqual({ first: 401, other: 401 });
  });

  it('should leave other accounts and their sessions alone', async () => {
    const a = await register();
    const b = await register();

    await dataOf(await complete(a.email, a.keys.recoveryAuthKey));

    expect((await call(API_PATHS.account, { token: b.token })).status).toBe(200);
  });

  it('should change nothing for a wrong recovery key', async () => {
    const { email, keys, token } = await register();
    const before = await env.DB.prepare('SELECT * FROM users').first();

    const res = await complete(email, randomKey());

    expect({
      error: await errorOf(res),
      unchanged: (await env.DB.prepare('SELECT * FROM users').first()) as unknown,
      session: (await call(API_PATHS.account, { token })).status,
      login: (await call(API_PATHS.login, { body: { email, loginKey: keys.loginKey } })).status,
    }).toEqual({
      error: { status: 401, code: 'INVALID_CREDENTIALS' },
      unchanged: before,
      session: 200,
      login: 200,
    });
  });

  it('should answer 400 for an invalid new setup', async () => {
    const { email, keys } = await register();

    const res = await call(API_PATHS.recoveryComplete, {
      body: { email, recoveryAuthKey: keys.recoveryAuthKey, keys: { salt: 'x' } },
    });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
