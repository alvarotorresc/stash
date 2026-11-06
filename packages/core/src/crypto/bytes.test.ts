import { describe, expect, it } from 'vitest';
import { CryptoError } from './errors';
import {
  concatBytes,
  constantTimeEqual,
  fromBase64Url,
  randomBytes,
  toBase64Url,
  utf8,
} from './bytes';

describe('toBase64Url', () => {
  it('should encode without padding using the url-safe alphabet', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe('-__-');
  });

  it('should encode an empty array as an empty string', () => {
    expect(toBase64Url(new Uint8Array())).toBe('');
  });
});

describe('fromBase64Url', () => {
  it('should decode what toBase64Url encodes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);

    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it.each(['abc=', 'ab+c', 'ab/c', 'a', 'ab c', 'AB=='])(
    'should throw INVALID_INPUT when the input is %j',
    (input) => {
      expect(() => fromBase64Url(input)).toThrow(
        expect.objectContaining({ name: 'CryptoError', code: 'INVALID_INPUT' }),
      );
    },
  );

  it('should throw when trailing bits are not zero', () => {
    // "AB" decodes to 0x00 with non-zero trailing bits; the canonical form is "AA".
    expect(() => fromBase64Url('AB')).toThrow(CryptoError);
  });
});

describe('constantTimeEqual', () => {
  it('should return true for equal arrays', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it('should return false when one byte differs', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
  });

  it('should return false when lengths differ', () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it('should return true for two empty arrays', () => {
    expect(constantTimeEqual(new Uint8Array(), new Uint8Array())).toBe(true);
  });
});

describe('randomBytes', () => {
  it('should return the requested number of bytes', () => {
    expect(randomBytes(16)).toHaveLength(16);
  });

  it('should return different values on each call', () => {
    expect(randomBytes(16)).not.toEqual(randomBytes(16));
  });
});

describe('concatBytes', () => {
  it('should join arrays in order', () => {
    expect(concatBytes(new Uint8Array([1]), new Uint8Array([2, 3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe('utf8', () => {
  it('should encode a string as utf-8', () => {
    expect(utf8('ñ')).toEqual(new Uint8Array([0xc3, 0xb1]));
  });
});
