import { describe, expect, it, vi } from 'vitest';
import {
  changePassword,
  createAccountKeys,
  derivePasswordCredentials,
  deriveRecoveryCredentials,
  recoverAccount,
} from './account';
import { fromBase64Url, toBase64Url } from './bytes';
import { DEFAULT_KDF_PARAMS } from './kdf';
import { decryptRecord, encryptRecord } from './records';

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';
const RECORD_ID = 'item-1';
const plaintext = new TextEncoder().encode('{"url":"https://example.com"}');

async function registerWithData(password = PASSWORD) {
  const account = await createAccountKeys({ email: EMAIL, password });
  const blob = await encryptRecord(account.dataKey, RECORD_ID, plaintext);
  return { account, blob };
}

function login(password: string, { salt, kdf }: { salt: string; kdf: unknown }, email = EMAIL) {
  return derivePasswordCredentials({ email, password, salt, kdf });
}

async function otherWellFormedCode(code: string): Promise<string> {
  let candidate = code;
  while (candidate === code) {
    candidate = (await createAccountKeys({ email: EMAIL, password: 'throwaway password' }))
      .recoveryCode;
  }
  return candidate;
}

describe('createAccountKeys', () => {
  it('should return what the server stores, in its sending format', async () => {
    const { server } = await createAccountKeys({ email: EMAIL, password: PASSWORD });

    expect({
      salt: fromBase64Url(server.salt).length,
      kdf: server.kdf,
      loginKey: fromBase64Url(server.loginKey).length,
      recoveryAuthKey: fromBase64Url(server.recoveryAuthKey).length,
      wrappedDataKey: fromBase64Url(server.wrappedDataKey).length,
      recoveryWrappedDataKey: fromBase64Url(server.recoveryWrappedDataKey).length,
    }).toEqual({
      salt: 16,
      kdf: DEFAULT_KDF_PARAMS,
      loginKey: 32,
      recoveryAuthKey: 32,
      wrappedDataKey: 61,
      recoveryWrappedDataKey: 61,
    });
  });

  it('should return a recovery code to show once', async () => {
    const { recoveryCode } = await createAccountKeys({ email: EMAIL, password: PASSWORD });

    expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('should use a new salt and data key for each account', async () => {
    const [first, second] = await Promise.all([
      createAccountKeys({ email: EMAIL, password: PASSWORD }),
      createAccountKeys({ email: EMAIL, password: PASSWORD }),
    ]);

    expect(first.server.salt).not.toBe(second.server.salt);
  });

  it.each(['', 'nine char'])(
    'should throw PASSWORD_TOO_SHORT for a password of fewer than 10 characters (%j)',
    async (password) => {
      await expect(createAccountKeys({ email: EMAIL, password: password })).rejects.toMatchObject({
        code: 'PASSWORD_TOO_SHORT',
      });
    },
  );
});

describe('derivePasswordCredentials', () => {
  it('should derive the same login key that registration sent', async () => {
    const { account } = await registerWithData();

    const credentials = await login(PASSWORD, account.server);

    expect(credentials.loginKey).toBe(account.server.loginKey);
  });

  it('should derive a different login key from a wrong password', async () => {
    const { account } = await registerWithData();

    const credentials = await login('wrong password', account.server);

    expect(credentials.loginKey).not.toBe(account.server.loginKey);
  });

  it('should treat composed and decomposed unicode as the same password', async () => {
    const { account } = await registerWithData('contraseña'.normalize('NFC'));

    const credentials = await login('contraseña'.normalize('NFD'), account.server);

    expect(credentials.loginKey).toBe(account.server.loginKey);
  });

  it('should not apply the length rule to the password typed at login', async () => {
    const { account } = await registerWithData();

    const credentials = await login('short', account.server);

    expect(credentials.loginKey).not.toBe(account.server.loginKey);
  });

  it('should throw INVALID_INPUT when the password is empty', async () => {
    const { account } = await registerWithData();

    await expect(login('', account.server)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('should reject parameters weaker than the defaults', async () => {
    const { account } = await registerWithData();

    await expect(
      derivePasswordCredentials({
        email: EMAIL,
        password: PASSWORD,
        salt: account.server.salt,
        kdf: { ...DEFAULT_KDF_PARAMS, memoryKiB: 8, iterations: 1 },
      }),
    ).rejects.toMatchObject({ code: 'INVALID_KDF_PARAMS' });
  });

  it.each([
    ['too short', toBase64Url(new Uint8Array(8))],
    ['not base64url', 'not a salt!'],
  ])('should throw INVALID_INPUT when the salt is %s', async (_, salt) => {
    await expect(
      derivePasswordCredentials({
        email: EMAIL,
        password: PASSWORD,
        salt,
        kdf: DEFAULT_KDF_PARAMS,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('salt bound to the email', () => {
  it('should accept the email with other case and surrounding spaces', async () => {
    const { account } = await registerWithData();

    const credentials = await login(PASSWORD, account.server, '  Ada@Example.COM ');

    expect(credentials.loginKey).toBe(account.server.loginKey);
  });

  it('should derive a different login key for another email with the same salt', async () => {
    // A server that hands every account the same salt still gets one Argon2id input per email.
    const { account } = await registerWithData();

    const other = await login(PASSWORD, account.server, 'grace@example.com');

    expect(other.loginKey).not.toBe(account.server.loginKey);
  });

  it('should not unlock the data key with the right password but another email', async () => {
    const { account } = await registerWithData();
    const other = await login(PASSWORD, account.server, 'grace@example.com');

    await expect(other.unlockDataKey(account.server.wrappedDataKey)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it.each(['', '   '])('should throw INVALID_INPUT for the email %j', async (email) => {
    await expect(createAccountKeys({ email, password: PASSWORD })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('PasswordCredentials.unlockDataKey', () => {
  it('should unlock a data key that decrypts what registration encrypted', async () => {
    const { account, blob } = await registerWithData();
    const credentials = await login(PASSWORD, account.server);

    const dataKey = await credentials.unlockDataKey(account.server.wrappedDataKey);

    expect(await decryptRecord(dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should decrypt in an independent instance with the same password', async () => {
    const { account, blob } = await registerWithData();
    vi.resetModules();
    const fresh = await import('./account');
    const freshRecords = await import('./records');

    const credentials = await fresh.derivePasswordCredentials({
      email: EMAIL,
      password: PASSWORD,
      ...account.server,
    });
    const dataKey = await credentials.unlockDataKey(account.server.wrappedDataKey);

    expect(await freshRecords.decryptRecord(dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should fail with a wrong password', async () => {
    const { account } = await registerWithData();
    const credentials = await login('wrong password', account.server);

    await expect(credentials.unlockDataKey(account.server.wrappedDataKey)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('should not open the recovery-wrapped copy', async () => {
    const { account } = await registerWithData();
    const credentials = await login(PASSWORD, account.server);

    await expect(
      credentials.unlockDataKey(account.server.recoveryWrappedDataKey),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });
});

describe('changePassword', () => {
  it('should keep the data readable with the new password', async () => {
    const { account, blob } = await registerWithData();
    const current = await login(PASSWORD, account.server);

    const { server } = await changePassword(current, {
      email: EMAIL,
      wrappedDataKey: account.server.wrappedDataKey,
      newPassword: NEW_PASSWORD,
    });
    const next = await login(NEW_PASSWORD, server);
    const dataKey = await next.unlockDataKey(server.wrappedDataKey);

    expect(await decryptRecord(dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should return a data key that still decrypts existing data', async () => {
    const { account, blob } = await registerWithData();
    const current = await login(PASSWORD, account.server);

    const { dataKey } = await changePassword(current, {
      email: EMAIL,
      wrappedDataKey: account.server.wrappedDataKey,
      newPassword: NEW_PASSWORD,
    });

    expect(await decryptRecord(dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should use a new salt and login key', async () => {
    const { account } = await registerWithData();
    const current = await login(PASSWORD, account.server);

    const { server } = await changePassword(current, {
      email: EMAIL,
      wrappedDataKey: account.server.wrappedDataKey,
      newPassword: NEW_PASSWORD,
    });

    expect({
      salt: server.salt === account.server.salt,
      loginKey: server.loginKey === account.server.loginKey,
    }).toEqual({ salt: false, loginKey: false });
  });

  it('should stop the old password from opening the new wrapped key', async () => {
    const { account } = await registerWithData();
    const current = await login(PASSWORD, account.server);
    const { server } = await changePassword(current, {
      email: EMAIL,
      wrappedDataKey: account.server.wrappedDataKey,
      newPassword: NEW_PASSWORD,
    });

    const old = await login(PASSWORD, server);

    await expect(old.unlockDataKey(server.wrappedDataKey)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('should keep the recovery code working', async () => {
    const { account, blob } = await registerWithData();
    const current = await login(PASSWORD, account.server);
    await changePassword(current, {
      email: EMAIL,
      wrappedDataKey: account.server.wrappedDataKey,
      newPassword: NEW_PASSWORD,
    });
    const recovery = await deriveRecoveryCredentials(account.recoveryCode);

    const recovered = await recoverAccount(recovery, {
      email: EMAIL,
      recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
      newPassword: 'third password',
    });

    expect(await decryptRecord(recovered.dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should fail when the current password is wrong', async () => {
    const { account } = await registerWithData();
    const wrong = await login('wrong password', account.server);

    await expect(
      changePassword(wrong, {
        email: EMAIL,
        wrappedDataKey: account.server.wrappedDataKey,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });

  it('should throw PASSWORD_TOO_SHORT when the new password is too short', async () => {
    const { account } = await registerWithData();
    const current = await login(PASSWORD, account.server);

    await expect(
      changePassword(current, {
        email: EMAIL,
        wrappedDataKey: account.server.wrappedDataKey,
        newPassword: 'too short',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
  });

  it('should reject credentials that core did not create', async () => {
    const { account } = await registerWithData();
    const forged = { loginKey: account.server.loginKey, unlockDataKey: vi.fn() };

    await expect(
      changePassword(forged, {
        email: EMAIL,
        wrappedDataKey: account.server.wrappedDataKey,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('deriveRecoveryCredentials', () => {
  it('should derive the recovery auth key that registration sent', async () => {
    const { account } = await registerWithData();

    const recovery = await deriveRecoveryCredentials(account.recoveryCode);

    expect(recovery.recoveryAuthKey).toBe(account.server.recoveryAuthKey);
  });

  it('should throw INVALID_RECOVERY_CODE for a malformed code', async () => {
    await expect(deriveRecoveryCredentials('not-a-code')).rejects.toMatchObject({
      code: 'INVALID_RECOVERY_CODE',
    });
  });
});

describe('recoverAccount', () => {
  it('should let the new password unlock the existing data', async () => {
    const { account, blob } = await registerWithData();
    const recovery = await deriveRecoveryCredentials(account.recoveryCode);

    const recovered = await recoverAccount(recovery, {
      email: EMAIL,
      recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
      newPassword: NEW_PASSWORD,
    });
    const credentials = await login(NEW_PASSWORD, recovered.server);
    const dataKey = await credentials.unlockDataKey(recovered.server.wrappedDataKey);

    expect(await decryptRecord(dataKey, RECORD_ID, blob)).toEqual(plaintext);
  });

  it('should issue a new recovery code that opens the new recovery-wrapped key', async () => {
    const { account, blob } = await registerWithData();
    const first = await recoverAccount(await deriveRecoveryCredentials(account.recoveryCode), {
      email: EMAIL,
      recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
      newPassword: NEW_PASSWORD,
    });

    const second = await recoverAccount(await deriveRecoveryCredentials(first.recoveryCode), {
      email: EMAIL,
      recoveryWrappedDataKey: first.server.recoveryWrappedDataKey,
      newPassword: 'third password',
    });

    expect({
      newCode: first.recoveryCode !== account.recoveryCode,
      plaintext: await decryptRecord(second.dataKey, RECORD_ID, blob),
    }).toEqual({ newCode: true, plaintext });
  });

  it('should stop the old code from opening the new recovery-wrapped key', async () => {
    const { account } = await registerWithData();
    const oldRecovery = await deriveRecoveryCredentials(account.recoveryCode);
    const recovered = await recoverAccount(oldRecovery, {
      email: EMAIL,
      recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
      newPassword: NEW_PASSWORD,
    });

    await expect(
      recoverAccount(oldRecovery, {
        email: EMAIL,
        recoveryWrappedDataKey: recovered.server.recoveryWrappedDataKey,
        newPassword: 'third password',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
  });

  it('should throw PASSWORD_TOO_SHORT when the new password is too short', async () => {
    const { account } = await registerWithData();
    const recovery = await deriveRecoveryCredentials(account.recoveryCode);

    await expect(
      recoverAccount(recovery, {
        email: EMAIL,
        recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
        newPassword: 'too short',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_TOO_SHORT' });
  });

  it('should throw INVALID_RECOVERY_CODE for a well-formed but wrong code', async () => {
    const { account } = await registerWithData();
    const wrong = await deriveRecoveryCredentials(await otherWellFormedCode(account.recoveryCode));

    await expect(
      recoverAccount(wrong, {
        email: EMAIL,
        recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
        newPassword: NEW_PASSWORD,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_RECOVERY_CODE' });
  });

  it('should reject credentials that core did not create', async () => {
    const { account } = await registerWithData();

    await expect(
      recoverAccount(
        { recoveryAuthKey: account.server.recoveryAuthKey },
        {
          email: EMAIL,
          recoveryWrappedDataKey: account.server.recoveryWrappedDataKey,
          newPassword: NEW_PASSWORD,
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});
