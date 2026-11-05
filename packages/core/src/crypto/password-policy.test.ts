import { describe, expect, it } from 'vitest';
import { COMMON_PASSWORDS } from './common-passwords';
import { MIN_PASSWORD_LENGTH, assertNewPassword, checkPassword } from './password-policy';

describe('MIN_PASSWORD_LENGTH', () => {
  it('should be 10 characters', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});

describe('checkPassword', () => {
  it('should accept a long uncommon password', () => {
    expect(checkPassword('violet tram under the bridge')).toEqual({
      length: 28,
      lengthOk: true,
      common: false,
    });
  });

  it('should reject 9 characters and accept 10', () => {
    expect([
      checkPassword('a'.repeat(9) + 'b').lengthOk,
      checkPassword('abcdefghi').lengthOk,
    ]).toEqual([true, false]);
  });

  it('should count code points after NFC, not UTF-16 units', () => {
    // Nine emoji are 18 UTF-16 units but only 9 characters.
    expect(checkPassword('🐦'.repeat(9))).toMatchObject({ length: 9, lengthOk: false });
  });

  it('should count a decomposed accent as one character', () => {
    // "e" + combining acute (NFD) becomes a single "é" in NFC.
    expect(checkPassword('cafécaféx').length).toBe(9);
  });

  it.each(['1234567890', 'qwertyuiop', 'Password123', 'CONTRASEÑA123'])(
    'should flag the common password %s',
    (password) => {
      expect(checkPassword(password).common).toBe(true);
    },
  );

  it('should not flag a common password with an extra word', () => {
    expect(checkPassword('qwertyuiop lighthouse').common).toBe(false);
  });
});

describe('COMMON_PASSWORDS', () => {
  it('should only hold lowercase NFC entries of at least the minimum length', () => {
    const invalid = [...COMMON_PASSWORDS].filter(
      (entry) =>
        [...entry].length < MIN_PASSWORD_LENGTH || entry !== entry.normalize('NFC').toLowerCase(),
    );

    expect({ size: COMMON_PASSWORDS.size > 50, invalid }).toEqual({ size: true, invalid: [] });
  });
});

describe('assertNewPassword', () => {
  it.each(['', 'short', '🐦'.repeat(9)])('should throw PASSWORD_TOO_SHORT for %j', (password) => {
    expect(() => assertNewPassword(password)).toThrow(
      expect.objectContaining({ name: 'CryptoError', code: 'PASSWORD_TOO_SHORT' }),
    );
  });

  it('should accept 10 characters, even a common password, which the UI blocks', () => {
    expect(() => assertNewPassword('1234567890')).not.toThrow();
  });
});
