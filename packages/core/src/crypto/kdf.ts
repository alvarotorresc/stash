import type sodiumType from 'libsodium-wrappers-sumo';
import { utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';

/**
 * Argon2id (version 1.3) parameters. They are stored next to the salt, so they can be raised
 * later: each account keeps its own until the next password change, which uses the defaults.
 */
export interface KdfParams {
  readonly algorithm: 'argon2id';
  readonly memoryKiB: number;
  readonly iterations: number;
  /** libsodium only implements p = 1. */
  readonly parallelism: 1;
}

export const DEFAULT_KDF_PARAMS: KdfParams = Object.freeze({
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
});

export const SALT_BYTES = 16;
const MASTER_KEY_BYTES = 32;

// The floor stops a server from downgrading the parameters to get a login key that is cheap
// to brute-force; the ceiling stops it from freezing the device.
const MEMORY_KIB_RANGE = [DEFAULT_KDF_PARAMS.memoryKiB, 1024 * 1024] as const;
const ITERATIONS_RANGE = [DEFAULT_KDF_PARAMS.iterations, 32] as const;

function inRange(value: unknown, [min, max]: readonly [number, number]): boolean {
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
    inRange(params.memoryKiB, MEMORY_KIB_RANGE) &&
    inRange(params.iterations, ITERATIONS_RANGE);
  if (!valid) {
    throw new CryptoError('INVALID_KDF_PARAMS', 'Unsupported key derivation parameters');
  }
}

let sodiumReady: Promise<typeof sodiumType> | undefined;

// Loaded on demand so the WebAssembly bundle stays out of the initial chunk.
function loadSodium(): Promise<typeof sodiumType> {
  sodiumReady ??= import('libsodium-wrappers-sumo').then(async ({ default: sodium }) => {
    await sodium.ready;
    return sodium;
  });
  return sodiumReady;
}

/** Runs Argon2id without validating the parameters; callers validate at the boundary. */
export async function argon2id(password: Bytes, salt: Bytes, params: KdfParams): Promise<Bytes> {
  const sodium = await loadSodium();
  const output = sodium.crypto_pwhash(
    MASTER_KEY_BYTES,
    password,
    salt,
    params.iterations,
    params.memoryKiB * 1024,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
  const copy = new Uint8Array(output);
  sodium.memzero(output);
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
