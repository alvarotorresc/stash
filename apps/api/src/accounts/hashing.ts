import { SALT_BYTES, constantTimeEqual, fromBase64Url, toBase64Url } from '@stash/core/protocol';

type Bytes = Uint8Array<ArrayBuffer>;

/**
 * Every secret value the Worker stores or derives goes through HMAC-SHA-256 under a subkey of
 * the pepper, one subkey per purpose, so a digest made for one purpose never matches another.
 * The keys hashed here are 256-bit random values, so a fast keyed hash is enough: there is
 * nothing to brute-force without the pepper.
 */
export type HashPurpose =
  'login-key' | 'recovery-key' | 'session-token' | 'fake-salt' | 'rate-limit';

const encoder = new TextEncoder();
const subkeys = new Map<string, Promise<CryptoKey>>();

async function importHmacKey(raw: BufferSource): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** subkey(purpose) = HMAC(pepper, "stash/v1/server/" ‖ purpose), cached per isolate. */
function subkey(pepper: string, purpose: HashPurpose): Promise<CryptoKey> {
  const cacheKey = `${purpose}\u0000${pepper}`;
  let key = subkeys.get(cacheKey);
  if (key === undefined) {
    key = (async () => {
      const root = await importHmacKey(encoder.encode(pepper));
      const derived = await crypto.subtle.sign(
        'HMAC',
        root,
        encoder.encode(`stash/v1/server/${purpose}`),
      );
      return importHmacKey(derived);
    })();
    subkeys.set(cacheKey, key);
  }
  return key;
}

export async function hmac(
  pepper: string,
  purpose: HashPurpose,
  message: Uint8Array | string,
): Promise<Bytes> {
  const data = typeof message === 'string' ? encoder.encode(message) : new Uint8Array(message);
  const signature = await crypto.subtle.sign('HMAC', await subkey(pepper, purpose), data);
  return new Uint8Array(signature);
}

/** Digest stored for a key the client sends (already decoded and length-checked). */
export async function hashKey(
  pepper: string,
  purpose: 'login-key' | 'recovery-key' | 'session-token',
  key: Uint8Array,
): Promise<string> {
  return toBase64Url(await hmac(pepper, purpose, key));
}

/** Compares a stored digest with a fresh one in constant time. */
export function digestsMatch(stored: string, candidate: string): boolean {
  return constantTimeEqual(fromBase64Url(stored), fromBase64Url(candidate));
}

/** Stand-in digest for a missing account, so the comparison still runs and always fails. */
export const NO_MATCH_DIGEST = toBase64Url(new Uint8Array(32));

/**
 * Salt returned for an email without an account: deterministic, so asking twice gives the same
 * answer, and indistinguishable from a real random salt without the pepper.
 */
export async function fakeSalt(pepper: string, email: string): Promise<string> {
  return toBase64Url((await hmac(pepper, 'fake-salt', email)).slice(0, SALT_BYTES));
}
