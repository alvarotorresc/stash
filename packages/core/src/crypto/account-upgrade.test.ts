import { describe, expect, it, vi } from 'vitest';
import { createAccountKeys, derivePasswordCredentials } from './account';
import { fromBase64Url } from './bytes';
import type { KdfParams } from './kdf';
import { decryptRecord, encryptRecord } from './records';

// Simulates a future release that raises the default parameters after accounts exist.
const defaults = vi.hoisted(() => ({ current: undefined as KdfParams | undefined }));

vi.mock('./kdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./kdf')>();
  return {
    ...actual,
    get DEFAULT_KDF_PARAMS() {
      return defaults.current ?? actual.DEFAULT_KDF_PARAMS;
    },
  };
});

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct horse battery staple';
const RAISED: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 4,
  parallelism: 1,
};

async function oldAccountUnderRaisedDefaults() {
  defaults.current = undefined;
  const account = await createAccountKeys({ email: EMAIL, password: PASSWORD });
  const blob = await encryptRecord(account.dataKey, 'item-1', new Uint8Array([1, 2, 3]));
  defaults.current = RAISED;
  return { account, blob };
}

function login(server: { salt: string; kdf: unknown }) {
  return derivePasswordCredentials({ email: EMAIL, password: PASSWORD, ...server });
}

describe('login with parameters below the current defaults', () => {
  it('should still log in with the account parameters', async () => {
    const { account } = await oldAccountUnderRaisedDefaults();

    const credentials = await login(account.server);

    expect(credentials.loginKey).toBe(account.server.loginKey);
  });

  it('should offer an upgrade with a new salt and the current defaults', async () => {
    const { account } = await oldAccountUnderRaisedDefaults();
    const credentials = await login(account.server);

    const { upgrade } = await credentials.unlockDataKey(account.server.wrappedDataKey);

    expect({
      kdf: upgrade?.kdf,
      saltBytes: upgrade && fromBase64Url(upgrade.salt).length,
      newSalt: upgrade?.salt !== account.server.salt,
      newLoginKey: upgrade?.loginKey !== account.server.loginKey,
      newWrap: upgrade?.wrappedDataKey !== account.server.wrappedDataKey,
    }).toEqual({ kdf: RAISED, saltBytes: 16, newSalt: true, newLoginKey: true, newWrap: true });
  });

  it('should let the same password log in with the upgrade and read the existing data', async () => {
    const { account, blob } = await oldAccountUnderRaisedDefaults();
    const { upgrade } = await (
      await login(account.server)
    ).unlockDataKey(account.server.wrappedDataKey);
    if (upgrade === null) throw new Error('expected an upgrade');

    const next = await login(upgrade);
    const { dataKey, upgrade: again } = await next.unlockDataKey(upgrade.wrappedDataKey);

    expect({
      loginKey: next.loginKey === upgrade.loginKey,
      data: await decryptRecord(dataKey, 'item-1', blob),
      again,
    }).toEqual({ loginKey: true, data: new Uint8Array([1, 2, 3]), again: null });
  });

  it('should return a non-extractable data key along with the upgrade', async () => {
    const { account, blob } = await oldAccountUnderRaisedDefaults();
    const { dataKey } = await (
      await login(account.server)
    ).unlockDataKey(account.server.wrappedDataKey);

    expect({
      extractable: dataKey.extractable,
      data: await decryptRecord(dataKey, 'item-1', blob),
    }).toEqual({ extractable: false, data: new Uint8Array([1, 2, 3]) });
  });
});
