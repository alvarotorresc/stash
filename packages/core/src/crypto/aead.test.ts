import { describe, expect, it } from 'vitest';
import { openKey, sealKey } from './aead';

function aesKey(extractable: boolean, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, usages);
}

async function rawOf(key: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', key));
}

describe('sealKey and openKey', () => {
  it('should unwrap the same key material that was wrapped', async () => {
    const kek = await aesKey(false, ['wrapKey', 'unwrapKey']);
    const key = await aesKey(true, ['encrypt', 'decrypt']);
    const sealed = await sealKey(kek, key, 'wrap:test');

    const opened = await openKey(kek, sealed, 'wrap:test', true);

    expect(await rawOf(opened)).toEqual(await rawOf(key));
  });

  it('should unwrap as non-extractable when asked to', async () => {
    const kek = await aesKey(false, ['wrapKey', 'unwrapKey']);
    const sealed = await sealKey(kek, await aesKey(true, ['encrypt']), 'wrap:test');

    const opened = await openKey(kek, sealed, 'wrap:test', false);

    expect(opened.extractable).toBe(false);
  });

  it('should fail to unwrap in another context', async () => {
    const kek = await aesKey(false, ['wrapKey', 'unwrapKey']);
    const sealed = await sealKey(kek, await aesKey(true, ['encrypt']), 'wrap:password');

    await expect(openKey(kek, sealed, 'wrap:recovery', false)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it('should fail to unwrap with another key', async () => {
    const sealed = await sealKey(
      await aesKey(false, ['wrapKey', 'unwrapKey']),
      await aesKey(true, ['encrypt']),
      'wrap:test',
    );

    await expect(
      openKey(await aesKey(false, ['wrapKey', 'unwrapKey']), sealed, 'wrap:test', false),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });
});
