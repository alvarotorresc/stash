import type sodiumType from 'libsodium-wrappers-sumo';
import { concatBytes, utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';
import { SALT_BYTES, normalizeEmail, type KdfParams } from './params';

export {
  DEFAULT_KDF_PARAMS,
  MAX_KDF_PARAMS,
  MIN_KDF_PARAMS,
  SALT_BYTES,
  assertKdfParams,
  needsKdfUpgrade,
  normalizeEmail,
} from './params';
export type { KdfParams } from './params';

const MASTER_KEY_BYTES = 32;

const SALT_TAG = 'stash/v1/argon2id-salt';

/**
 * The effective Argon2id salt mixes the account's email into the salt the server stores:
 * `SHA-256("stash/v1/argon2id-salt" ‖ u32be(len(email)) ‖ email ‖ serverSalt)[0..16]`.
 * A server that handed several accounts the same salt still gets one Argon2id input per
 * account, so a single dictionary pass cannot cover them all. Changing the email therefore
 * requires re-deriving the password keys.
 */
export async function bindSaltToEmail(email: string, serverSalt: Bytes): Promise<Bytes> {
  const emailBytes = utf8(normalizeEmail(email));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, emailBytes.length);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    concatBytes(utf8(SALT_TAG), length, emailBytes, serverSalt),
  );
  return new Uint8Array(digest, 0, SALT_BYTES).slice();
}

export type Sodium = typeof sodiumType;

/**
 * Runs Argon2id without validating the parameters; callers validate at the boundary. Only the
 * Argon2id worker calls it: libsodium frees its output buffer without wiping it, so the master
 * key stays in the WebAssembly heap until the worker is terminated.
 */
export function argon2id(sodium: Sodium, password: Bytes, salt: Bytes, params: KdfParams): Bytes {
  let output: Uint8Array;
  try {
    output = sodium.crypto_pwhash(
      MASTER_KEY_BYTES,
      password,
      salt,
      params.iterations,
      params.memoryKiB * 1024,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
  } catch {
    // Typically the WebAssembly heap could not grow to the requested memory.
    throw new CryptoError('KDF_FAILED', 'Argon2id failed');
  }
  const copy = new Uint8Array(output);
  output.fill(0);
  return copy;
}

/** Imports input key material as a non-extractable HKDF key. */
export function importKeyMaterial(ikm: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits', 'deriveKey']);
}

function hkdfParams(info: string | Bytes, salt: Bytes): HkdfParams {
  return {
    name: 'HKDF',
    hash: 'SHA-256',
    salt,
    info: typeof info === 'string' ? utf8(info) : info,
  };
}

/** HKDF-SHA-256 output bytes. Used for keys that are sent to the server. */
export async function deriveBits(
  base: CryptoKey,
  info: string | Bytes,
  lengthBytes: number,
  salt: Bytes = new Uint8Array(),
): Promise<Bytes> {
  const bits = await crypto.subtle.deriveBits(hkdfParams(info, salt), base, lengthBytes * 8);
  return new Uint8Array(bits);
}

/** HKDF-SHA-256 into a non-extractable AES-256-GCM key. */
export function deriveAesKey(
  base: CryptoKey,
  info: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    hkdfParams(info, new Uint8Array()),
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}
