import { openKey, sealKey } from './aead';
import { derivePasswordKeysInWorker } from './argon2-client';
import { fromBase64Url, randomBytes, toBase64Url, utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';
import { DEFAULT_KDF_PARAMS, SALT_BYTES, assertKdfParams, type KdfParams } from './kdf';
import { INFO, splitKeyMaterial, type SplitKeys } from './key-chain';
import { assertNewPassword } from './password-policy';
import type { DataKey } from './records';
import { generateRecoveryCode, parseRecoveryCode } from './recovery-code';

/**
 * Key chain, version 1 (D31):
 *
 * - password → Argon2id(salt) → HKDF → login key (sent) + password KEK
 * - recovery code (128 bits) → HKDF → recovery auth key (sent) + recovery KEK
 * - data key: 256 random bits, wrapped with AES-256-GCM by each KEK
 *
 * Changing the password or recovering re-wraps the data key; no data is re-encrypted.
 * The password is normalised to NFC, so every keyboard yields the same bytes.
 */
const WRAP_CONTEXT = {
  password: 'data-key:password',
  recovery: 'data-key:recovery',
} as const;

/** What the server stores for the password. */
export interface PasswordSetup {
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly loginKey: string;
  readonly wrappedDataKey: string;
}

/** What the server stores for the recovery code. */
export interface RecoverySetup {
  readonly recoveryAuthKey: string;
  readonly recoveryWrappedDataKey: string;
}

export interface AccountKeys {
  /** Sent to the server. Keys are base64url; the server stores only their hashes. */
  readonly server: PasswordSetup & RecoverySetup;
  /** Shown to the user once and never stored. */
  readonly recoveryCode: string;
  readonly dataKey: DataKey;
}

export interface PasswordCredentials {
  /** Sent to the server to log in. */
  readonly loginKey: string;
  unlockDataKey(wrappedDataKey: string): Promise<DataKey>;
}

export interface RecoveryCredentials {
  /** Sent to the server to start a recovery. */
  readonly recoveryAuthKey: string;
}

async function derivePasswordKeys(
  password: string,
  salt: Bytes,
  params: KdfParams,
): Promise<SplitKeys> {
  if (password.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Password is required');
  }
  // Argon2id runs in a disposable worker; the master key never reaches this thread.
  return derivePasswordKeysInWorker({ password: utf8(password.normalize('NFC')), salt, params });
}

function decodeSalt(salt: string): Bytes {
  const bytes = fromBase64Url(salt);
  if (bytes.length !== SALT_BYTES) {
    throw new CryptoError('INVALID_INPUT', 'Invalid salt');
  }
  return bytes;
}

async function unwrap(
  kek: CryptoKey,
  wrapped: string,
  context: string,
  extractable: boolean,
): Promise<CryptoKey> {
  return openKey(kek, fromBase64Url(wrapped), context, extractable);
}

class PasswordCredentialsHandle implements PasswordCredentials {
  readonly #kek: CryptoKey;

  constructor(
    readonly loginKey: string,
    kek: CryptoKey,
  ) {
    this.#kek = kek;
  }

  async unlockDataKey(wrappedDataKey: string): Promise<DataKey> {
    return (await unwrap(this.#kek, wrappedDataKey, WRAP_CONTEXT.password, false)) as DataKey;
  }

  static kekOf(credentials: PasswordCredentials): CryptoKey {
    if (!(credentials instanceof PasswordCredentialsHandle)) {
      throw new CryptoError('INVALID_INPUT', 'Unknown credentials');
    }
    return credentials.#kek;
  }
}

class RecoveryCredentialsHandle implements RecoveryCredentials {
  readonly #kek: CryptoKey;

  constructor(
    readonly recoveryAuthKey: string,
    kek: CryptoKey,
  ) {
    this.#kek = kek;
  }

  static kekOf(credentials: RecoveryCredentials): CryptoKey {
    if (!(credentials instanceof RecoveryCredentialsHandle)) {
      throw new CryptoError('INVALID_INPUT', 'Unknown credentials');
    }
    return credentials.#kek;
  }
}

/** Wraps an extractable data key under a new password and returns its non-extractable copy. */
async function setUpPassword(
  password: string,
  extractableDataKey: CryptoKey,
): Promise<{ setup: PasswordSetup; dataKey: DataKey }> {
  const salt = randomBytes(SALT_BYTES);
  const kdf = { ...DEFAULT_KDF_PARAMS };
  const { sentKey, kek } = await derivePasswordKeys(password, salt, kdf);
  const wrapped = await sealKey(kek, extractableDataKey, WRAP_CONTEXT.password);
  const dataKey = (await openKey(kek, wrapped, WRAP_CONTEXT.password, false)) as DataKey;
  return {
    setup: {
      salt: toBase64Url(salt),
      kdf,
      loginKey: sentKey,
      wrappedDataKey: toBase64Url(wrapped),
    },
    dataKey,
  };
}

async function setUpAccount(password: string, extractableDataKey: CryptoKey): Promise<AccountKeys> {
  const { code, secret } = await generateRecoveryCode();
  const [{ setup, dataKey }, recovery] = await Promise.all([
    setUpPassword(password, extractableDataKey),
    splitKeyMaterial(secret, INFO.recoveryAuthKey, INFO.recoveryKek),
  ]);
  const recoveryWrapped = await sealKey(recovery.kek, extractableDataKey, WRAP_CONTEXT.recovery);
  return {
    server: {
      ...setup,
      recoveryAuthKey: recovery.sentKey,
      recoveryWrappedDataKey: toBase64Url(recoveryWrapped),
    },
    recoveryCode: code,
    dataKey,
  };
}

/** Registration: creates the data key, the recovery code and everything the server stores. */
export async function createAccountKeys(password: string): Promise<AccountKeys> {
  assertNewPassword(password);
  const extractableDataKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  return setUpAccount(password, extractableDataKey);
}

/**
 * Login: derives the login key from the password and the salt and parameters the server
 * returned. The parameters are validated, so a server cannot weaken them.
 */
export async function derivePasswordCredentials(
  password: string,
  { salt, kdf }: { salt: string; kdf: unknown },
): Promise<PasswordCredentials> {
  assertKdfParams(kdf);
  const { sentKey, kek } = await derivePasswordKeys(password, decodeSalt(salt), kdf);
  return new PasswordCredentialsHandle(sentKey, kek);
}

/**
 * Password change: re-wraps the data key under the new password with a new salt and the
 * current default parameters. The recovery code keeps working.
 */
export async function changePassword(
  current: PasswordCredentials,
  wrappedDataKey: string,
  newPassword: string,
): Promise<{ server: PasswordSetup; dataKey: DataKey }> {
  assertNewPassword(newPassword);
  const kek = PasswordCredentialsHandle.kekOf(current);
  const extractableDataKey = await unwrap(kek, wrappedDataKey, WRAP_CONTEXT.password, true);
  const { setup, dataKey } = await setUpPassword(newPassword, extractableDataKey);
  return { server: setup, dataKey };
}

/** First step of a recovery: parses the code and derives the auth key to send. */
export async function deriveRecoveryCredentials(code: string): Promise<RecoveryCredentials> {
  const secret = await parseRecoveryCode(code);
  const { sentKey, kek } = await splitKeyMaterial(secret, INFO.recoveryAuthKey, INFO.recoveryKek);
  return new RecoveryCredentialsHandle(sentKey, kek);
}

/**
 * Second step of a recovery: opens the data key with the recovery code and sets a new
 * password and a new recovery code, to be shown once.
 */
export async function recoverAccount(
  recovery: RecoveryCredentials,
  recoveryWrappedDataKey: string,
  newPassword: string,
): Promise<AccountKeys> {
  assertNewPassword(newPassword);
  const kek = RecoveryCredentialsHandle.kekOf(recovery);
  let extractableDataKey: CryptoKey;
  try {
    extractableDataKey = await unwrap(kek, recoveryWrappedDataKey, WRAP_CONTEXT.recovery, true);
  } catch {
    throw new CryptoError('INVALID_RECOVERY_CODE', 'Invalid recovery code');
  }
  return setUpAccount(newPassword, extractableDataKey);
}
