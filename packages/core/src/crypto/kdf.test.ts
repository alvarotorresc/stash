import { argon2id as referenceArgon2id } from '@noble/hashes/argon2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import sodium from 'libsodium-wrappers-sumo';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_KDF_PARAMS,
  MAX_KDF_PARAMS,
  MIN_KDF_PARAMS,
  argon2id,
  assertKdfParams,
  bindSaltToEmail,
  deriveAesKey,
  deriveBits,
  importKeyMaterial,
  needsKdfUpgrade,
  normalizeEmail,
  type KdfParams,
} from './kdf';

function hex(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function smallParams(memoryKiB: number, iterations: number): KdfParams {
  return { algorithm: 'argon2id', memoryKiB, iterations, parallelism: 1 };
}

describe('argon2id', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  it('should be checked against a reference that passes the RFC 9106 test vector', () => {
    // RFC 9106 §5.3. libsodium only runs p = 1 without secret or associated data, so this
    // vector anchors the reference implementation that the next tests compare against.
    const tag = referenceArgon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      t: 3,
      m: 32,
      p: 4,
      dkLen: 32,
      key: new Uint8Array(8).fill(3),
      personalization: new Uint8Array(12).fill(4),
    });

    expect(toHex(tag)).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it.each([
    { password: 'password', memoryKiB: 8, iterations: 1 },
    { password: 'correct horse battery staple', memoryKiB: 256, iterations: 2 },
    { password: 'ñandú 🐦', memoryKiB: 1024, iterations: 4 },
  ])(
    'should match the reference for m=$memoryKiB t=$iterations',
    async ({ password, memoryKiB, iterations }) => {
      const salt = new Uint8Array(16).map((_, index) => index);
      const encoded = new TextEncoder().encode(password);

      const derived = argon2id(sodium, encoded, salt, smallParams(memoryKiB, iterations));

      expect(toHex(derived)).toBe(
        toHex(referenceArgon2id(encoded, salt, { t: iterations, m: memoryKiB, p: 1, dkLen: 32 })),
      );
    },
  );

  it('should match the reference with the production parameters', async () => {
    const salt = new Uint8Array(16).fill(0xa5);
    const encoded = new TextEncoder().encode('production parameters');

    const derived = argon2id(sodium, encoded, salt, DEFAULT_KDF_PARAMS);

    expect(toHex(derived)).toBe(
      toHex(referenceArgon2id(encoded, salt, { t: 3, m: 65536, p: 1, dkLen: 32 })),
    );
  });

  it('should throw KDF_FAILED when libsodium fails, as when memory runs out', () => {
    const failing = {
      ...sodium,
      crypto_pwhash: () => {
        throw new Error('Cannot enlarge memory');
      },
    };

    expect(() =>
      argon2id(failing, new Uint8Array(4), new Uint8Array(16), DEFAULT_KDF_PARAMS),
    ).toThrow(expect.objectContaining({ code: 'KDF_FAILED' }));
  });
});

describe('DEFAULT_KDF_PARAMS', () => {
  it('should be m = 64 MiB, t = 3, p = 1', () => {
    expect(DEFAULT_KDF_PARAMS).toEqual({
      algorithm: 'argon2id',
      memoryKiB: 65536,
      iterations: 3,
      parallelism: 1,
    });
  });
});

describe('MIN_KDF_PARAMS', () => {
  it('should be set on its own, not taken from the defaults', () => {
    expect(MIN_KDF_PARAMS).not.toBe(DEFAULT_KDF_PARAMS);
  });

  it('should never be above the defaults', () => {
    expect(
      MIN_KDF_PARAMS.memoryKiB <= DEFAULT_KDF_PARAMS.memoryKiB &&
        MIN_KDF_PARAMS.iterations <= DEFAULT_KDF_PARAMS.iterations,
    ).toBe(true);
  });

  it('should never go below the OWASP minimum of m = 19 MiB, t = 2', () => {
    expect(MIN_KDF_PARAMS.memoryKiB >= 19 * 1024 && MIN_KDF_PARAMS.iterations >= 2).toBe(true);
  });

  it('should be m = 64 MiB, t = 3 for now', () => {
    expect({ memoryKiB: MIN_KDF_PARAMS.memoryKiB, iterations: MIN_KDF_PARAMS.iterations }).toEqual({
      memoryKiB: 65536,
      iterations: 3,
    });
  });
});

describe('MAX_KDF_PARAMS', () => {
  it('should cap the cost at m = 256 MiB, t = 10 so a hostile server cannot freeze a phone', () => {
    expect({ memoryKiB: MAX_KDF_PARAMS.memoryKiB, iterations: MAX_KDF_PARAMS.iterations }).toEqual({
      memoryKiB: 262144,
      iterations: 10,
    });
  });
});

describe('assertKdfParams', () => {
  it('should accept the default parameters', () => {
    expect(() => assertKdfParams({ ...DEFAULT_KDF_PARAMS })).not.toThrow();
  });

  it('should accept the floor and the ceiling', () => {
    expect(() => {
      assertKdfParams({ ...MIN_KDF_PARAMS });
      assertKdfParams({ ...MAX_KDF_PARAMS });
    }).not.toThrow();
  });

  it('should accept stronger parameters', () => {
    expect(() =>
      assertKdfParams({ ...DEFAULT_KDF_PARAMS, memoryKiB: 131072, iterations: 4 }),
    ).not.toThrow();
  });

  it.each([
    ['memory one KiB under the floor', { ...MIN_KDF_PARAMS, memoryKiB: 65535 }],
    ['iterations under the floor', { ...MIN_KDF_PARAMS, iterations: 2 }],
    ['weaker memory', { ...DEFAULT_KDF_PARAMS, memoryKiB: 8 }],
    ['fewer iterations', { ...DEFAULT_KDF_PARAMS, iterations: 1 }],
    ['memory one KiB over the ceiling', { ...MAX_KDF_PARAMS, memoryKiB: 262145 }],
    ['iterations over the ceiling', { ...MAX_KDF_PARAMS, iterations: 11 }],
    ['1 GiB of memory', { ...DEFAULT_KDF_PARAMS, memoryKiB: 1024 * 1024 }],
    ['excessive iterations', { ...DEFAULT_KDF_PARAMS, iterations: 1000 }],
    ['parallelism other than 1', { ...DEFAULT_KDF_PARAMS, parallelism: 4 }],
    ['an unknown algorithm', { ...DEFAULT_KDF_PARAMS, algorithm: 'scrypt' }],
    ['a fractional value', { ...DEFAULT_KDF_PARAMS, iterations: 3.5 }],
    ['a string value', { ...DEFAULT_KDF_PARAMS, memoryKiB: '65536' }],
    ['NaN', { ...DEFAULT_KDF_PARAMS, memoryKiB: Number.NaN }],
    ['null', null],
    ['a string', 'argon2id'],
  ])('should throw INVALID_KDF_PARAMS for %s', (_, params) => {
    expect(() => assertKdfParams(params)).toThrow(
      expect.objectContaining({ code: 'INVALID_KDF_PARAMS' }),
    );
  });
});

describe('needsKdfUpgrade', () => {
  const defaults = smallParams(1024, 4);

  it('should be false for the current defaults', () => {
    expect(needsKdfUpgrade(DEFAULT_KDF_PARAMS)).toBe(false);
  });

  it.each([
    ['less memory', smallParams(512, 4), true],
    ['fewer iterations', smallParams(1024, 3), true],
    ['the same parameters', smallParams(1024, 4), false],
    ['stronger parameters', smallParams(2048, 5), false],
  ])('should be true only when below the defaults: %s', (_, params, expected) => {
    expect(needsKdfUpgrade(params, defaults)).toBe(expected);
  });
});

describe('deriveBits', () => {
  it('should match RFC 5869 test case 1', async () => {
    const base = await importKeyMaterial(hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'));

    const okm = await deriveBits(
      base,
      hex('f0f1f2f3f4f5f6f7f8f9'),
      42,
      hex('000102030405060708090a0b0c'),
    );

    expect(toHex(okm)).toBe(
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865',
    );
  });

  it('should match RFC 5869 test case 3, with empty salt and info', async () => {
    const base = await importKeyMaterial(hex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'));

    const okm = await deriveBits(base, '', 42);

    expect(toHex(okm)).toBe(
      '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8',
    );
  });

  it('should give unrelated output for different info labels', async () => {
    const base = await importKeyMaterial(new Uint8Array(32).fill(7));

    const [first, second] = await Promise.all([
      deriveBits(base, 'stash/v1/a', 32),
      deriveBits(base, 'stash/v1/b', 32),
    ]);

    expect(first).not.toEqual(second);
  });
});

describe('importKeyMaterial', () => {
  it('should return a non-extractable key', async () => {
    const base = await importKeyMaterial(new Uint8Array(32));

    expect(base.extractable).toBe(false);
  });
});

describe('deriveAesKey', () => {
  it('should return a non-extractable AES-256-GCM key with the requested usages', async () => {
    const base = await importKeyMaterial(new Uint8Array(32));

    const key = await deriveAesKey(base, 'stash/v1/test', ['wrapKey', 'unwrapKey']);

    expect({
      extractable: key.extractable,
      algorithm: key.algorithm,
      usages: [...key.usages].sort(),
    }).toEqual({
      extractable: false,
      algorithm: { name: 'AES-GCM', length: 256 },
      usages: ['unwrapKey', 'wrapKey'],
    });
  });
});

describe('normalizeEmail', () => {
  it('should trim, apply NFC and lowercase', () => {
    expect(normalizeEmail('  Jose\u0301@Example.COM\n')).toBe('josé@example.com');
  });

  it.each(['', ' \t '])('should throw INVALID_INPUT for %j', (email) => {
    expect(() => normalizeEmail(email)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  });
});

describe('bindSaltToEmail', () => {
  const serverSalt = new Uint8Array(16).map((_, index) => index);

  it('should be SHA-256(tag ‖ u32be(len(email)) ‖ email ‖ server salt), first 16 bytes', async () => {
    const tag = new TextEncoder().encode('stash/v1/argon2id-salt');
    const email = new TextEncoder().encode('ada@example.com');
    const expected = sha256(
      new Uint8Array([...tag, 0, 0, 0, email.length, ...email, ...serverSalt]),
    ).slice(0, 16);

    expect(toHex(await bindSaltToEmail(' ADA@example.com', serverSalt))).toBe(toHex(expected));
  });

  it('should give different salts to different emails with the same server salt', async () => {
    const [first, second] = await Promise.all([
      bindSaltToEmail('ada@example.com', serverSalt),
      bindSaltToEmail('grace@example.com', serverSalt),
    ]);

    expect(toHex(first)).not.toBe(toHex(second));
  });
});
