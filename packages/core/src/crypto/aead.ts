import { concatBytes, randomBytes, utf8, type Bytes } from './bytes';
import { CryptoError } from './errors';

/**
 * Sealed format, version 1: `0x01 ‖ nonce (12 bytes) ‖ AES-256-GCM ciphertext ‖ tag (16 bytes)`.
 * The associated data is `0x01 ‖ "stash/v1/" ‖ context`, so the version byte is authenticated
 * and a sealed value only opens in the context it was sealed for.
 */
const FORMAT_VERSION = 1;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + NONCE_BYTES;

function decryptionFailed(): CryptoError {
  return new CryptoError('DECRYPTION_FAILED', 'Could not decrypt');
}

function gcmParams(nonce: Bytes, context: string): AesGcmParams {
  return {
    name: 'AES-GCM',
    iv: nonce,
    additionalData: concatBytes(new Uint8Array([FORMAT_VERSION]), utf8(`stash/v1/${context}`)),
    tagLength: TAG_BYTES * 8,
  };
}

function split(sealed: Uint8Array): { nonce: Bytes; ciphertext: Bytes } {
  if (sealed.length < HEADER_BYTES + TAG_BYTES || sealed[0] !== FORMAT_VERSION) {
    throw decryptionFailed();
  }
  return {
    nonce: sealed.slice(1, HEADER_BYTES),
    ciphertext: sealed.slice(HEADER_BYTES),
  };
}

function join(nonce: Bytes, ciphertext: ArrayBuffer): Bytes {
  return concatBytes(new Uint8Array([FORMAT_VERSION]), nonce, new Uint8Array(ciphertext));
}

export async function seal(key: CryptoKey, plaintext: Uint8Array, context: string): Promise<Bytes> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    gcmParams(nonce, context),
    key,
    new Uint8Array(plaintext),
  );
  return join(nonce, ciphertext);
}

export async function open(key: CryptoKey, sealed: Uint8Array, context: string): Promise<Bytes> {
  const { nonce, ciphertext } = split(sealed);
  try {
    return new Uint8Array(await crypto.subtle.decrypt(gcmParams(nonce, context), key, ciphertext));
  } catch {
    throw decryptionFailed();
  }
}

/** Wraps a key in the sealed format. The key must be extractable. */
export async function sealKey(kek: CryptoKey, key: CryptoKey, context: string): Promise<Bytes> {
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = await crypto.subtle.wrapKey('raw', key, kek, gcmParams(nonce, context));
  return join(nonce, ciphertext);
}

/** Unwraps an AES-256-GCM key from the sealed format. */
export async function openKey(
  kek: CryptoKey,
  sealed: Uint8Array,
  context: string,
  extractable: boolean,
): Promise<CryptoKey> {
  const { nonce, ciphertext } = split(sealed);
  try {
    return await crypto.subtle.unwrapKey(
      'raw',
      ciphertext,
      kek,
      gcmParams(nonce, context),
      { name: 'AES-GCM', length: 256 },
      extractable,
      ['encrypt', 'decrypt'],
    );
  } catch {
    throw decryptionFailed();
  }
}
