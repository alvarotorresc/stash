import sodium from 'libsodium-wrappers-sumo';
import type { Bytes } from './bytes';
import { argon2id, type KdfParams } from './kdf';
import { INFO, splitKeyMaterial, type SplitKeys } from './key-chain';

/**
 * Runs inside the Argon2id worker only (see `argon2-client.ts`): the master key never leaves
 * the worker, which is terminated after each derivation so its WebAssembly memory is dropped.
 */
export interface PasswordKeyRequest {
  /** UTF-8 of the NFC password. Transferred to the worker and wiped there. */
  readonly password: Bytes;
  /** The effective Argon2id salt, already bound to the email. */
  readonly salt: Bytes;
  /** Already validated against the floor and the ceiling. */
  readonly params: KdfParams;
}

/** The login key to send (base64url) and the non-extractable password KEK. */
export type PasswordKeys = SplitKeys;

export type PasswordKeyResponse = ({ readonly ok: true } & PasswordKeys) | { readonly ok: false };

/** Argon2id, then HKDF into the login key and the KEK. Never throws: failures become `ok: false`. */
export async function handlePasswordKeyRequest({
  password,
  salt,
  params,
}: PasswordKeyRequest): Promise<PasswordKeyResponse> {
  try {
    await sodium.ready;
    const masterKey = argon2id(sodium, password, salt, params);
    const { sentKey, kek } = await splitKeyMaterial(masterKey, INFO.loginKey, INFO.passwordKek);
    return { ok: true, sentKey, kek };
  } catch {
    return { ok: false };
  } finally {
    password.fill(0);
  }
}
