import {
  API_PATHS,
  DEFAULT_KDF_PARAMS,
  fromBase64Url,
  type LoginResponse,
  type PreloginResponse,
} from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { call, dataOf, errorOf, randomKey, register, uniqueEmail } from './helpers';

function prelogin(email: string): Promise<Response> {
  return call(API_PATHS.prelogin, { body: { email } });
}

describe('POST /api/auth/prelogin', () => {
  it('should return the stored salt and parameters, and nothing else', async () => {
    const { email, keys } = await register();

    const data = await dataOf<PreloginResponse>(await prelogin(email.toUpperCase()));

    expect(data).toEqual({ salt: keys.salt, kdf: keys.kdf });
  });

  it('should return a stable 16-byte salt and the defaults for an unknown email', async () => {
    const email = uniqueEmail();

    const first = await dataOf<PreloginResponse>(await prelogin(email));
    const second = await dataOf<PreloginResponse>(await prelogin(` ${email.toUpperCase()}`));

    expect({
      same: first.salt === second.salt,
      bytes: fromBase64Url(first.salt).length,
      kdf: first.kdf,
    }).toEqual({ same: true, bytes: 16, kdf: DEFAULT_KDF_PARAMS });
  });

  it('should return different fake salts for different unknown emails', async () => {
    const a = await dataOf<PreloginResponse>(await prelogin(uniqueEmail()));
    const b = await dataOf<PreloginResponse>(await prelogin(uniqueEmail()));

    expect(a.salt).not.toBe(b.salt);
  });

  it('should answer an unknown email with the same shape and headers as a real one', async () => {
    const { email } = await register();

    const real = await prelogin(email);
    const fake = await prelogin(uniqueEmail());

    expect({
      status: fake.status,
      keys: Object.keys(((await fake.json()) as { data: object }).data),
      contentType: fake.headers.get('content-type'),
    }).toEqual({
      status: real.status,
      keys: Object.keys(((await real.json()) as { data: object }).data),
      contentType: real.headers.get('content-type'),
    });
  });

  it('should answer 400 for an invalid email', async () => {
    expect(await errorOf(await prelogin('nope'))).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  });
});

describe('POST /api/auth/login', () => {
  it('should open a session and return the wrapped data key for the right login key', async () => {
    const { email, keys } = await register();

    const data = await dataOf<LoginResponse>(
      await call(API_PATHS.login, {
        body: { email: email.toUpperCase(), loginKey: keys.loginKey },
      }),
    );
    const me = await call(API_PATHS.account, { token: data.session.token });

    expect({ wrapped: data.wrappedDataKey, me: me.status }).toEqual({
      wrapped: keys.wrappedDataKey,
      me: 200,
    });
  });

  it('should open a different session on every login', async () => {
    const { email, keys, token } = await register();

    const again = await dataOf<LoginResponse>(
      await call(API_PATHS.login, { body: { email, loginKey: keys.loginKey } }),
    );

    expect(again.session.token).not.toBe(token);
  });

  it('should answer 401 INVALID_CREDENTIALS for a wrong login key', async () => {
    const { email } = await register();

    const res = await call(API_PATHS.login, { body: { email, loginKey: randomKey() } });

    expect(await errorOf(res)).toEqual({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('should answer an unknown email exactly like a wrong login key', async () => {
    const { email } = await register();

    const wrongKey = await call(API_PATHS.login, { body: { email, loginKey: randomKey() } });
    const unknown = await call(API_PATHS.login, {
      body: { email: uniqueEmail(), loginKey: randomKey() },
    });

    expect({ status: unknown.status, body: await unknown.text() }).toEqual({
      status: wrongKey.status,
      body: await wrongKey.text(),
    });
  });

  it('should answer 400 for a malformed login key', async () => {
    const res = await call(API_PATHS.login, { body: { email: uniqueEmail(), loginKey: 'short' } });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
