/**
 * - `DECRYPTION_FAILED`: wrong key, tampered data or unknown format. The causes are
 *   deliberately not told apart.
 * - `INVALID_INPUT`: malformed input, such as bad base64url or an empty password.
 * - `INVALID_KDF_PARAMS`: Argon2id parameters outside the accepted range.
 * - `INVALID_RECOVERY_CODE`: a malformed recovery code, or one that does not open the key.
 * - `PASSWORD_TOO_SHORT`: a new password under `MIN_PASSWORD_LENGTH` characters.
 */
export type CryptoErrorCode =
  | 'DECRYPTION_FAILED'
  | 'INVALID_INPUT'
  | 'INVALID_KDF_PARAMS'
  | 'INVALID_RECOVERY_CODE'
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
