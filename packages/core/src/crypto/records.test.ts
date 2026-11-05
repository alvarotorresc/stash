import { describe, expect, it } from 'vitest';
import { decryptRecord, encryptRecord, type DataKey } from './records';

async function testDataKey(): Promise<DataKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return key as DataKey;
}

const plaintext = new TextEncoder().encode('{"title":"Saved for later"}');
const decryptionFailed = expect.objectContaining({
  name: 'CryptoError',
  code: 'DECRYPTION_FAILED',
});

describe('encryptRecord', () => {
  it('should produce version byte + 96-bit nonce + ciphertext and 128-bit tag', async () => {
    const key = await testDataKey();

    const blob = await encryptRecord(key, 'record-1', plaintext);

    expect({ version: blob[0], length: blob.length }).toEqual({
      version: 1,
      length: 1 + 12 + plaintext.length + 16,
    });
  });

  it('should use a different nonce on every call', async () => {
    const key = await testDataKey();

    const blobs = await Promise.all(
      Array.from({ length: 20 }, () => encryptRecord(key, 'record-1', plaintext)),
    );

    const nonces = new Set(blobs.map((blob) => blob.slice(1, 13).join(',')));
    expect(nonces.size).toBe(20);
  });

  it('should throw INVALID_INPUT when the record id is empty', async () => {
    const key = await testDataKey();

    await expect(encryptRecord(key, '', plaintext)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('decryptRecord', () => {
  it('should return the original plaintext', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', plaintext);

    const decrypted = await decryptRecord(key, 'record-1', blob);

    expect(decrypted).toEqual(plaintext);
  });

  it('should round-trip an empty plaintext', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', new Uint8Array());

    const decrypted = await decryptRecord(key, 'record-1', blob);

    expect(decrypted).toEqual(new Uint8Array());
  });

  it('should fail when any single byte of the blob is altered', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', plaintext);

    const results = await Promise.allSettled(
      Array.from(blob.keys(), (index) => {
        const tampered = blob.slice();
        tampered[index] = (tampered[index] as number) ^ 0x01;
        return decryptRecord(key, 'record-1', tampered);
      }),
    );

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it('should fail with an opaque error when a byte is altered', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', plaintext);
    blob[blob.length - 1] = (blob[blob.length - 1] as number) ^ 0x80;

    await expect(decryptRecord(key, 'record-1', blob)).rejects.toEqual(decryptionFailed);
  });

  it('should fail when the blob is moved to another record', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', plaintext);

    await expect(decryptRecord(key, 'record-2', blob)).rejects.toEqual(decryptionFailed);
  });

  it('should fail with another key', async () => {
    const blob = await encryptRecord(await testDataKey(), 'record-1', plaintext);

    await expect(decryptRecord(await testDataKey(), 'record-1', blob)).rejects.toEqual(
      decryptionFailed,
    );
  });

  it('should fail with an unknown format version', async () => {
    const key = await testDataKey();
    const blob = await encryptRecord(key, 'record-1', plaintext);
    blob[0] = 2;

    await expect(decryptRecord(key, 'record-1', blob)).rejects.toEqual(decryptionFailed);
  });

  it('should fail when the blob is shorter than its header and tag', async () => {
    const key = await testDataKey();

    await expect(decryptRecord(key, 'record-1', new Uint8Array(28))).rejects.toEqual(
      decryptionFailed,
    );
  });
});
