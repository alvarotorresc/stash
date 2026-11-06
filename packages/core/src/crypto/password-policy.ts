import { COMMON_PASSWORDS } from './common-passwords';
import { CryptoError } from './errors';

/**
 * Minimum length of a new password, in characters (Unicode code points after NFC). There are
 * no rules about case or symbols: length is what makes a password expensive to guess.
 */
export const MIN_PASSWORD_LENGTH = 10;

export interface PasswordCheck {
  /** Characters, counted as code points after NFC. */
  readonly length: number;
  /** Whether the password meets `MIN_PASSWORD_LENGTH`. */
  readonly lengthOk: boolean;
  /** Whether the password is on the embedded list of very common passwords (case-insensitive). */
  readonly common: boolean;
}

function codePointLength(normalized: string): number {
  return [...normalized].length;
}

/**
 * Pure check meant for the password field and its strength meter: the UI shows the result and
 * blocks common passwords. Core itself only enforces the length (see `assertNewPassword`).
 */
export function checkPassword(password: string): PasswordCheck {
  const normalized = password.normalize('NFC');
  const length = codePointLength(normalized);
  return {
    length,
    lengthOk: length >= MIN_PASSWORD_LENGTH,
    common: COMMON_PASSWORDS.has(normalized.toLowerCase()),
  };
}

/**
 * Enforced on every new password (registration, password change and recovery), but not on the
 * password typed at login, so a future change of the rule never locks anyone out.
 */
export function assertNewPassword(password: string): void {
  if (codePointLength(password.normalize('NFC')) < MIN_PASSWORD_LENGTH) {
    throw new CryptoError(
      'PASSWORD_TOO_SHORT',
      `Password must have at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}
