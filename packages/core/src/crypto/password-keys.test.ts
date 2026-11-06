import { argon2id as referenceArgon2id } from '@noble/hashes/argon2.js';
import sodium from 'libsodium-wrappers-sumo';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64Url } from './bytes';
import { deriveBits, importKeyMaterial, type KdfParams } from './kdf';
import { INFO } from './key-chain';
import { handlePasswordKeyRequest } from './password-keys';

const PARAMS: KdfParams = { algorithm: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 1 };
const SALT = new Uint8Array(16).fill(3);

function request(password = 'correct horse battery staple') {
  return { password: new TextEncoder().encode(password), salt: SALT, params: PARAMS };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handlePasswordKeyRequest', () => {
  it('should return the HKDF login key of the Argon2id master key', async () => {
    const masterKey = referenceArgon2id(request().password, SALT, {
      t: 2,
      m: 1024,
      p: 1,
      dkLen: 32,
    });
    const expected = toBase64Url(
      await deriveBits(await importKeyMaterial(new Uint8Array(masterKey)), INFO.loginKey, 32),
    );

    const response = await handlePasswordKeyRequest(request());

    expect(response.ok && response.sentKey).toBe(expected);
  });

  it('should return a non-extractable KEK that can only wrap and unwrap', async () => {
    const response = await handlePasswordKeyRequest(request());

    expect(
      response.ok && {
        extractable: response.kek.extractable,
        usages: [...response.kek.usages].sort(),
      },
    ).toEqual({ extractable: false, usages: ['unwrapKey', 'wrapKey'] });
  });

  it('should return only the login key and the KEK, never the master key', async () => {
    const response = await handlePasswordKeyRequest(request());

    expect(Object.keys(response).sort()).toEqual(['kek', 'ok', 'sentKey']);
  });

  it('should wipe the password bytes', async () => {
    const input = request();

    await handlePasswordKeyRequest(input);

    expect(input.password.every((byte) => byte === 0)).toBe(true);
  });

  it('should answer ok: false and still wipe the password when Argon2id fails', async () => {
    vi.spyOn(sodium, 'crypto_pwhash').mockImplementation(() => {
      throw new Error('Cannot enlarge memory');
    });
    const input = request();

    const response = await handlePasswordKeyRequest(input);

    expect({ response, wiped: input.password.every((byte) => byte === 0) }).toEqual({
      response: { ok: false },
      wiped: true,
    });
  });
});
