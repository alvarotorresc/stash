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

/** Trim, NFC and lowercase (locale-independent). Throws INVALID_INPUT when nothing is left. */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().normalize('NFC').toLowerCase();
  if (normalized.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Email is required');
  }
  return normalized;
}
