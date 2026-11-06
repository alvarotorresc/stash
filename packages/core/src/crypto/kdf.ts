import type sodiumType from 'libsodium-wrappers-sumo';
import { concatBytes, utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';

/**
 * Argon2id (version 1.3) parameters. They are stored next to the salt, so each account keeps
 * its own. When an account logs in with parameters below the current defaults, core re-derives
 * its keys with the defaults and a new salt so the app can send the upgrade to the server.
 */
export interface KdfParams {
  readonly algorithm: 'argon2id';
  readonly memoryKiB: number;
  readonly iterations: number;
  /** libsodium only implements p = 1. */
  readonly parallelism: 1;
}

/** Used for every new password. Raising them later is safe: old accounts upgrade on login. */
export const DEFAULT_KDF_PARAMS: KdfParams = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
});

/**
 * Floor: the weakest parameters accepted from the server, so it cannot downgrade them to get a
 * login key that is cheap to brute-force. Set by hand, independently of the defaults: lowering
 * it is a deliberate decision and never below the OWASP minimum (m = 19 MiB, t = 2).
 */
export const MIN_KDF_PARAMS: KdfParams = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
});

/**
 * Ceiling: the strongest parameters accepted from the server, so it cannot make the device
 * hang. 256 MiB is four times the default memory and still fits in the WebAssembly heap of a
 * modest phone; together with t = 10 it caps a login at about 13 times the default cost.
 */
export const MAX_KDF_PARAMS: KdfParams = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 256 * 1024,
  iterations: 10,
  parallelism: 1,
});

export const SALT_BYTES = 16;
const MASTER_KEY_BYTES = 32;

function inRange(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

/** Validates parameters that come from outside, such as the server's login response. */
export function assertKdfParams(value: unknown): asserts value is KdfParams {
  const params = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const valid =
    params.algorithm === 'argon2id' &&
    params.parallelism === 1 &&
    inRange(params.memoryKiB, MIN_KDF_PARAMS.memoryKiB, MAX_KDF_PARAMS.memoryKiB) &&
    inRange(params.iterations, MIN_KDF_PARAMS.iterations, MAX_KDF_PARAMS.iterations);
  if (!valid) {
    throw new CryptoError('INVALID_KDF_PARAMS', 'Unsupported key derivation parameters');
  }
}

/** Whether an account's parameters are weaker than the defaults in any dimension. */
export function needsKdfUpgrade(
  params: KdfParams,
  defaults: KdfParams = DEFAULT_KDF_PARAMS,
): boolean {
  return params.memoryKiB < defaults.memoryKiB || params.iterations < defaults.iterations;
}

const SALT_TAG = 'stash/v1/argon2id-salt';

/** Trim, NFC and lowercase (locale-independent). Throws INVALID_INPUT when nothing is left. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().normalize('NFC').toLowerCase();
  if (normalized.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Email is required');
  }
  return normalized;
}

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
