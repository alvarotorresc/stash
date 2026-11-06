import { openKey, sealKey } from './aead';
import { derivePasswordKeysInWorker } from './argon2-client';
import { fromBase64Url, randomBytes, toBase64Url, utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';
import {
  DEFAULT_KDF_PARAMS,
  SALT_BYTES,
  assertKdfParams,
  bindSaltToEmail,
  needsKdfUpgrade,
  normalizeEmail,
  type KdfParams,
} from './kdf';
import { INFO, splitKeyMaterial, type SplitKeys } from './key-chain';
import { assertNewPassword } from './password-policy';
import type { DataKey } from './records';
import type { PasswordSetup, RecoverySetup } from './setup';
import { generateRecoveryCode, parseRecoveryCode } from './recovery-code';

export type { PasswordSetup, RecoverySetup } from './setup';

/**
 * Key chain, version 1 (D31):
 *
 * - password → Argon2id(salt bound to the email) → HKDF → login key (sent) + password KEK
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

export interface AccountKeys {
  /** Sent to the server. Keys are base64url; the server stores only their hashes. */
  readonly server: PasswordSetup & RecoverySetup;
  /** Shown to the user once and never stored. */
  readonly recoveryCode: string;
  readonly dataKey: DataKey;
}

export interface UnlockedDataKey {
  readonly dataKey: DataKey;
  /**
   * Set when the account's Argon2id parameters are below the current defaults: the same
   * password under a new salt and the defaults. Send it to the server, within the session that
   * just logged in, to replace the stored password setup. `null` when nothing needs upgrading.
   */
  readonly upgrade: PasswordSetup | null;
}

/** Single use: `unlockDataKey` works once. Do not keep it in long-lived state. */
export interface PasswordCredentials {
  /** Sent to the server to log in. */
  readonly loginKey: string;
  unlockDataKey(wrappedDataKey: string): Promise<UnlockedDataKey>;
}

/** Single use: `recoverAccount` consumes it. */
export interface RecoveryCredentials {
  /** Sent to the server to start a recovery. */
  readonly recoveryAuthKey: string;
}

async function derivePasswordKeys(
  email: string,
  password: string,
  serverSalt: Bytes,
  params: KdfParams,
): Promise<SplitKeys> {
  if (password.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Password is required');
  }
  const salt = await bindSaltToEmail(email, serverSalt);
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

function credentialsUsed(): CryptoError {
  return new CryptoError('CREDENTIALS_USED', 'Credentials can only be used once');
}

/** Keys for a new password, before the data key is wrapped under them. */
interface NewPasswordKeys extends SplitKeys {
  readonly salt: Bytes;
  readonly kdf: KdfParams;
}

/** Derives keys for a password under a fresh random salt and the default parameters. */
async function deriveNewPasswordKeys(email: string, password: string): Promise<NewPasswordKeys> {
  const salt = randomBytes(SALT_BYTES);
  const kdf = { ...DEFAULT_KDF_PARAMS };
  return { ...(await derivePasswordKeys(email, password, salt, kdf)), salt, kdf };
}

/** Wraps an extractable data key under new password keys and returns its non-extractable copy. */
async function wrapUnderPassword(
  keys: NewPasswordKeys,
  extractableDataKey: CryptoKey,
): Promise<{ setup: PasswordSetup; dataKey: DataKey }> {
  const wrapped = await sealKey(keys.kek, extractableDataKey, WRAP_CONTEXT.password);
  const dataKey = (await openKey(keys.kek, wrapped, WRAP_CONTEXT.password, false)) as DataKey;
  return {
    setup: {
      salt: toBase64Url(keys.salt),
      kdf: keys.kdf,
      loginKey: keys.sentKey,
      wrappedDataKey: toBase64Url(wrapped),
    },
    dataKey,
  };
}

/** Holds the KEKs privately and hands them out once. */
class PasswordCredentialsHandle implements PasswordCredentials {
  #keys: { kek: CryptoKey; upgrade: NewPasswordKeys | null } | null;

  constructor(
    readonly loginKey: string,
    kek: CryptoKey,
    upgrade: NewPasswordKeys | null,
  ) {
    this.#keys = { kek, upgrade };
  }

  async unlockDataKey(wrappedDataKey: string): Promise<UnlockedDataKey> {
    const keys = this.#keys;
    if (keys === null) throw credentialsUsed();
    this.#keys = null;
    if (keys.upgrade === null) {
      const dataKey = await unwrap(keys.kek, wrappedDataKey, WRAP_CONTEXT.password, false);
      return { dataKey: dataKey as DataKey, upgrade: null };
    }
    // The extractable copy only lives inside this function, to be re-wrapped.
    const extractable = await unwrap(keys.kek, wrappedDataKey, WRAP_CONTEXT.password, true);
    const { setup, dataKey } = await wrapUnderPassword(keys.upgrade, extractable);
    return { dataKey, upgrade: setup };
  }
}

class RecoveryCredentialsHandle implements RecoveryCredentials {
  #kek: CryptoKey | null;

  constructor(
    readonly recoveryAuthKey: string,
    kek: CryptoKey,
  ) {
    this.#kek = kek;
  }

  static takeKek(credentials: RecoveryCredentials): CryptoKey {
    if (!(credentials instanceof RecoveryCredentialsHandle)) {
      throw new CryptoError('INVALID_INPUT', 'Unknown credentials');
    }
    const kek = credentials.#kek;
    if (kek === null) throw credentialsUsed();
    credentials.#kek = null;
    return kek;
  }
}

async function setUpPassword(
  email: string,
  password: string,
  extractableDataKey: CryptoKey,
): Promise<{ setup: PasswordSetup; dataKey: DataKey }> {
  return wrapUnderPassword(await deriveNewPasswordKeys(email, password), extractableDataKey);
}

async function setUpAccount(
  email: string,
  password: string,
  extractableDataKey: CryptoKey,
): Promise<AccountKeys> {
  const { code, secret } = await generateRecoveryCode();
  const [{ setup, dataKey }, recovery] = await Promise.all([
    setUpPassword(email, password, extractableDataKey),
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
export async function createAccountKeys({
  email,
  password,
}: {
  email: string;
  password: string;
}): Promise<AccountKeys> {
  normalizeEmail(email);
  assertNewPassword(password);
  const extractableDataKey = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
  return setUpAccount(email, password, extractableDataKey);
}

/**
 * Login: derives the login key from the email, the password and the salt and parameters the
 * server returned. The parameters are validated, so a server cannot weaken them, and the salt
 * is bound to the email, so a server cannot share one salt between accounts.
 *
 * When the parameters are below the current defaults, it also derives keys for the same
 * password under a new salt and the defaults (a second Argon2id run, once per account), so
 * `unlockDataKey` can return the upgrade without keeping the password.
 */
export async function derivePasswordCredentials({
  email,
  password,
  salt,
  kdf,
}: {
  email: string;
  password: string;
  salt: string;
  kdf: unknown;
}): Promise<PasswordCredentials> {
  assertKdfParams(kdf);
  const { sentKey, kek } = await derivePasswordKeys(email, password, decodeSalt(salt), kdf);
  const upgrade = needsKdfUpgrade(kdf, DEFAULT_KDF_PARAMS)
    ? await deriveNewPasswordKeys(email, password)
    : null;
  return new PasswordCredentialsHandle(sentKey, kek, upgrade);
}

/**
 * Password change: proves the current password by deriving its keys and opening the data key,
 * then re-wraps the data key under the new password with a new salt and the default
 * parameters. It takes the current password rather than login credentials, so nothing left
 * alive after a login can re-wrap the data key under a password of someone else's choosing.
 * The server authorises the change with `currentLoginKey`. The recovery code keeps working.
 */
export async function changePassword({
  email,
  currentPassword,
  newPassword,
  salt,
  kdf,
  wrappedDataKey,
}: {
  email: string;
  currentPassword: string;
  newPassword: string;
  salt: string;
  kdf: unknown;
  wrappedDataKey: string;
}): Promise<{ currentLoginKey: string; server: PasswordSetup; dataKey: DataKey }> {
  assertNewPassword(newPassword);
  assertKdfParams(kdf);
  const current = await derivePasswordKeys(email, currentPassword, decodeSalt(salt), kdf);
  const extractableDataKey = await unwrap(current.kek, wrappedDataKey, WRAP_CONTEXT.password, true);
  const { setup, dataKey } = await setUpPassword(email, newPassword, extractableDataKey);
  return { currentLoginKey: current.sentKey, server: setup, dataKey };
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
  {
    email,
    recoveryWrappedDataKey,
    newPassword,
  }: { email: string; recoveryWrappedDataKey: string; newPassword: string },
): Promise<AccountKeys> {
  assertNewPassword(newPassword);
  normalizeEmail(email);
  const kek = RecoveryCredentialsHandle.takeKek(recovery);
  let extractableDataKey: CryptoKey;
  try {
    extractableDataKey = await unwrap(kek, recoveryWrappedDataKey, WRAP_CONTEXT.recovery, true);
  } catch {
    throw new CryptoError('INVALID_RECOVERY_CODE', 'Invalid recovery code');
  }
  return setUpAccount(email, newPassword, extractableDataKey);
}
