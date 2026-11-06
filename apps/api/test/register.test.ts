import { env } from 'cloudflare:workers';
import { API_PATHS, type AccountResponse } from '@stash/core/protocol';
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES } from '../src/accounts/validation';
import { accountSetup, call, dataOf, errorOf, randomKey, register, uniqueEmail } from './helpers';

describe('POST /api/auth/register', () => {
  it('should create the account and return a working 30-day session', async () => {
    const account = await register();

    const me = await dataOf<AccountResponse>(
      await call(API_PATHS.account, { token: account.token }),
    );

    expect({
      email: me.email,
      salt: me.salt,
      kdf: me.kdf,
      wrappedDataKey: me.wrappedDataKey,
      ttlDays: (account.session.expiresAt - me.createdAt) / 86_400_000,
    }).toEqual({
      email: account.email,
      salt: account.keys.salt,
      kdf: account.keys.kdf,
      wrappedDataKey: account.keys.wrappedDataKey,
      ttlDays: 30,
    });
  });

  it('should store the email normalised as the clients bind it into the salt', async () => {
    const account = await register('  Ada.Lovelace@Example.COM ');

    const me = await dataOf<AccountResponse>(
      await call(API_PATHS.account, { token: account.token }),
    );

    expect(me.email).toBe('ada.lovelace@example.com');
  });

  it('should store digests of the keys, never the keys themselves', async () => {
    const { keys } = await register();

    const row = await env.DB.prepare('SELECT * FROM users').first<Record<string, unknown>>();
    const stored = JSON.stringify(row);

    expect([stored.includes(keys.loginKey), stored.includes(keys.recoveryAuthKey)]).toEqual([
      false,
      false,
    ]);
  });

  it('should answer 409 EMAIL_TAKEN for an email that exists, in any case', async () => {
    const { email } = await register();

    const res = await call(API_PATHS.register, {
      body: { email: email.toUpperCase(), keys: accountSetup() },
    });

    expect(await errorOf(res)).toEqual({ status: 409, code: 'EMAIL_TAKEN' });
  });

  it.each([
    ['a missing email', { keys: accountSetup() }],
    ['an empty email', { email: '   ', keys: accountSetup() }],
    ['an email without @', { email: 'ada.example.com', keys: accountSetup() }],
    ['an email without domain', { email: 'ada@', keys: accountSetup() }],
    ['an email with spaces', { email: 'ada lovelace@example.com', keys: accountSetup() }],
    ['an email over 254 characters', { email: `${'a'.repeat(250)}@x.io`, keys: accountSetup() }],
    ['missing keys', { email: uniqueEmail() }],
    ['keys that are not an object', { email: uniqueEmail(), keys: [] }],
    [
      'a short login key',
      { email: uniqueEmail(), keys: { ...accountSetup(), loginKey: randomKey(16) } },
    ],
    [
      'a login key that is not base64url',
      { email: uniqueEmail(), keys: { ...accountSetup(), loginKey: '+'.repeat(43) } },
    ],
    ['a short salt', { email: uniqueEmail(), keys: { ...accountSetup(), salt: randomKey(8) } }],
    [
      'a wrapped key of the wrong size',
      { email: uniqueEmail(), keys: { ...accountSetup(), wrappedDataKey: randomKey(32) } },
    ],
    [
      'a recovery wrapped key of the wrong size',
      { email: uniqueEmail(), keys: { ...accountSetup(), recoveryWrappedDataKey: 7 } },
    ],
    [
      'a missing recovery key',
      { email: uniqueEmail(), keys: { ...accountSetup(), recoveryAuthKey: undefined } },
    ],
    [
      'kdf parameters below the floor',
      {
        email: uniqueEmail(),
        keys: {
          ...accountSetup(),
          kdf: { algorithm: 'argon2id', memoryKiB: 1024, iterations: 1, parallelism: 1 },
        },
      },
    ],
    [
      'an unknown kdf',
      { email: uniqueEmail(), keys: { ...accountSetup(), kdf: { algorithm: 'scrypt' } } },
    ],
  ])('should answer 400 VALIDATION_ERROR for %s', async (_case, body) => {
    const res = await call(API_PATHS.register, { body });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('should answer 400 for a body that is not JSON', async () => {
    const res = await call(API_PATHS.register, { body: '{not json' });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('should answer 400 for a JSON body that is not an object', async () => {
    const res = await call(API_PATHS.register, { body: '[1, 2]' });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('should answer 413 for a body over the size limit', async () => {
    const res = await call(API_PATHS.register, {
      body: { email: uniqueEmail(), padding: 'x'.repeat(MAX_BODY_BYTES) },
    });

    expect(await errorOf(res)).toEqual({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('should answer 413 when the declared length is over the limit', async () => {
    const res = await call(API_PATHS.register, {
      body: { email: uniqueEmail() },
      headers: { 'Content-Length': String(MAX_BODY_BYTES + 1) },
    });

    expect(await errorOf(res)).toEqual({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
  });

  it('should answer 405 with Allow for another method', async () => {
    const res = await call(API_PATHS.register, { method: 'GET' });

    expect([res.headers.get('allow'), (await errorOf(res)).code]).toEqual([
      'POST',
      'METHOD_NOT_ALLOWED',
    ]);
  });
});

describe('unknown account routes', () => {
  it.each(['/api/auth/unknown', '/api/account/unknown'])(
    'should answer 404 for %s',
    async (path) => {
      const res = await call(path);

      expect(await errorOf(res)).toEqual({ status: 404, code: 'NOT_FOUND' });
    },
  );
});
