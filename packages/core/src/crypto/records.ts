import { open, seal } from './aead';
import type { Bytes } from './bytes';
import { CryptoError } from './errors';

declare const dataKeyBrand: unique symbol;

/**
 * The account's data key: a non-extractable AES-256-GCM CryptoKey. Only `core` creates one,
 * so its raw bytes can never be read from JavaScript.
 */
export type DataKey = CryptoKey & { readonly [dataKeyBrand]: true };

function recordContext(recordId: string): string {
  if (recordId.length === 0) {
    throw new CryptoError('INVALID_INPUT', 'Record id is required');
  }
  return `record:${recordId}`;
}

/** Encrypts a record. The id is bound to the blob, so it cannot be moved to another record. */
export async function encryptRecord(
  key: DataKey,
  recordId: string,
  plaintext: Uint8Array,
): Promise<Bytes> {
  return seal(key, plaintext, recordContext(recordId));
}

/** Decrypts a record blob. Throws `DECRYPTION_FAILED` on any mismatch or tampering. */
export async function decryptRecord(
  key: DataKey,
  recordId: string,
  blob: Uint8Array,
): Promise<Bytes> {
  return open(key, blob, recordContext(recordId));
}
