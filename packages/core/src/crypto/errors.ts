/**
 * - `CREDENTIALS_USED`: password or recovery credentials are single use; derive them again.
 * - `DECRYPTION_FAILED`: wrong key, tampered data or unknown format. The causes are
 *   deliberately not told apart.
 * - `INVALID_INPUT`: malformed input, such as bad base64url or an empty password.
 * - `INVALID_KDF_PARAMS`: Argon2id parameters outside the accepted range.
 * - `INVALID_RECOVERY_CODE`: a malformed recovery code, or one that does not open the key.
 * - `KDF_FAILED`: Argon2id could not run, for example out of memory or without Web Workers.
 * - `PASSWORD_TOO_SHORT`: a new password under `MIN_PASSWORD_LENGTH` characters.
 */
export type CryptoErrorCode =
  | 'CREDENTIALS_USED'
  | 'DECRYPTION_FAILED'
  | 'INVALID_INPUT'
  | 'INVALID_KDF_PARAMS'
  | 'INVALID_RECOVERY_CODE'
  | 'KDF_FAILED'
  | 'PASSWORD_TOO_SHORT';

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
