/**
 * - `DECRYPTION_FAILED`: wrong key, tampered data or unknown format. The causes are
 *   deliberately not told apart.
 * - `INVALID_INPUT`: malformed input, such as bad base64url or an empty password.
 * - `INVALID_KDF_PARAMS`: Argon2id parameters outside the accepted range.
 * - `INVALID_RECOVERY_CODE`: a malformed recovery code, or one that does not open the key.
 */
export type CryptoErrorCode =
  'DECRYPTION_FAILED' | 'INVALID_INPUT' | 'INVALID_KDF_PARAMS' | 'INVALID_RECOVERY_CODE';

export class CryptoError extends Error {
  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}
