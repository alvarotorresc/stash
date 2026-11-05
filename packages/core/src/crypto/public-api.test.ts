import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import * as core from '../index';

const PASSWORD = 'correct horse battery staple';

/** Collects every CryptoKey and every raw byte container reachable from a value. */
function collect(value: unknown, found = { keys: [] as CryptoKey[], bytes: [] as unknown[] }) {
  if (value instanceof CryptoKey) {
    found.keys.push(value);
  } else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    found.bytes.push(value);
  } else if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) collect(child, found);
  }
  return found;
}

async function everyPublicResult(): Promise<unknown[]> {
  const account = await core.createAccountKeys(PASSWORD);
  const credentials = await core.derivePasswordCredentials(PASSWORD, account.server);
  const unlocked = await credentials.unlockDataKey(account.server.wrappedDataKey);
  const changed = await core.changePassword(
    credentials,
    account.server.wrappedDataKey,
    'new password',
  );
  const recovery = await core.deriveRecoveryCredentials(account.recoveryCode);
  const recovered = await core.recoverAccount(
    recovery,
    account.server.recoveryWrappedDataKey,
    'newer password',
  );
  const store = core.createIndexedDbDataKeyStore({ indexedDB: new IDBFactory() });
  await store.save(unlocked);
  const persisted = await store.load();
  return [account, credentials, unlocked, changed, recovery, recovered, persisted];
}

describe('public API', () => {
  it('should export only the intended functions and values', () => {
    expect(Object.keys(core).sort()).toEqual([
      'CryptoError',
      'DATA_KEY_TTL_MS',
      'DEFAULT_KDF_PARAMS',
      'MIN_PASSWORD_LENGTH',
      'PRIORITIES',
      'changePassword',
      'checkPassword',
      'constantTimeEqual',
      'createAccountKeys',
      'createIndexedDbDataKeyStore',
      'decryptRecord',
      'derivePasswordCredentials',
      'deriveRecoveryCredentials',
      'encryptRecord',
      'fromBase64Url',
      'isPriority',
      'recoverAccount',
      'toBase64Url',
    ]);
  });

  it('should never return raw key bytes', async () => {
    const results = await everyPublicResult();

    expect(collect(results).bytes).toEqual([]);
  });

  it('should return only non-extractable keys', async () => {
    const { keys } = collect(await everyPublicResult());

    expect(keys.length > 0 && keys.every((key) => !key.extractable)).toBe(true);
  });

  it('should refuse to export any returned key', async () => {
    const { keys } = collect(await everyPublicResult());

    const exports = await Promise.allSettled(
      keys.map((key) => crypto.subtle.exportKey('raw', key)),
    );

    expect(exports.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('should expose only the login key from password credentials', async () => {
    const account = await core.createAccountKeys(PASSWORD);

    const credentials = await core.derivePasswordCredentials(PASSWORD, account.server);

    expect(JSON.parse(JSON.stringify(credentials))).toEqual({
      loginKey: account.server.loginKey,
    });
  });

  it('should expose only the auth key from recovery credentials', async () => {
    const account = await core.createAccountKeys(PASSWORD);

    const recovery = await core.deriveRecoveryCredentials(account.recoveryCode);

    expect(JSON.parse(JSON.stringify(recovery))).toEqual({
      recoveryAuthKey: account.server.recoveryAuthKey,
    });
  });
});
