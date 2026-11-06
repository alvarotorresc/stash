/**
 * Wire contract of the account API, shared by the clients and the Worker. This module has no
 * dependency on the Argon2id worker, libsodium or DOM types, so the Worker can import it through
 * `@stash/core/protocol` without bundling or type-checking them.
 */
import type { KdfParams } from '../crypto/params';
import type { PasswordSetup, RecoverySetup } from '../crypto/setup';

export { constantTimeEqual, fromBase64Url, toBase64Url } from '../crypto/encoding';
export {
  DEFAULT_KDF_PARAMS,
  MAX_KDF_PARAMS,
  MIN_KDF_PARAMS,
  SALT_BYTES,
  assertKdfParams,
  normalizeEmail,
} from '../crypto/params';
export type { KdfParams } from '../crypto/params';
export type { PasswordSetup, RecoverySetup } from '../crypto/setup';

/** Bytes of the keys the clients send: login key and recovery auth key. */
export const SENT_KEY_BYTES = 32;
/** Bytes of a wrapped data key: version, 12-byte nonce, 32-byte key and 16-byte tag. */
export const WRAPPED_DATA_KEY_BYTES = 61;
/** Longest email accepted, after normalisation (RFC 5321 path limit). */
export const MAX_EMAIL_LENGTH = 254;

export const API_PATHS = {
  register: '/api/auth/register',
  prelogin: '/api/auth/prelogin',
  login: '/api/auth/login',
  logout: '/api/auth/logout',
  recoveryStart: '/api/auth/recovery/start',
  recoveryComplete: '/api/auth/recovery/complete',
  account: '/api/account',
  password: '/api/account/password',
  passwordBegin: '/api/account/password/begin',
  kdf: '/api/account/kdf',
} as const;

/** Error codes the account API returns in `{ error: { code } }`. */
export type AccountErrorCode =
  | 'CROSS_SITE_REQUEST'
  | 'EMAIL_TAKEN'
  | 'INTERNAL_ERROR'
  | 'INVALID_CREDENTIALS'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'VALIDATION_ERROR';

/** An opaque bearer token and when it stops working (Unix time in milliseconds). */
export interface SessionGrant {
  readonly token: string;
  readonly expiresAt: number;
}

export type AccountSetup = PasswordSetup & RecoverySetup;

export interface RegisterRequest {
  readonly email: string;
  readonly keys: AccountSetup;
}
export interface RegisterResponse {
  readonly session: SessionGrant;
}

export interface PreloginRequest {
  readonly email: string;
}
export interface PreloginResponse {
  readonly salt: string;
  readonly kdf: KdfParams;
}

export interface LoginRequest {
  readonly email: string;
  readonly loginKey: string;
}
export interface LoginResponse {
  readonly session: SessionGrant;
  readonly wrappedDataKey: string;
}

/**
 * What a session token alone can read. Never the wrapped data key: with it, whoever holds a
 * stolen token could try passwords offline, with no rate limit.
 */
export interface AccountResponse {
  readonly email: string;
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly createdAt: number;
}

/** First step of a password change: proves the current password to get the wrapped data key. */
export interface PasswordBeginRequest {
  readonly currentLoginKey: string;
}
export interface PasswordBeginResponse {
  readonly wrappedDataKey: string;
}

/** Password change and Argon2id parameter upgrade: proven with the current login key. */
export interface ReplacePasswordRequest {
  readonly currentLoginKey: string;
  readonly keys: PasswordSetup;
}

export interface RecoveryStartRequest {
  readonly email: string;
  readonly recoveryAuthKey: string;
}
export interface RecoveryStartResponse {
  readonly recoveryWrappedDataKey: string;
}

export interface RecoveryCompleteRequest {
  readonly email: string;
  readonly recoveryAuthKey: string;
  readonly keys: AccountSetup;
}
export interface RecoveryCompleteResponse {
  readonly session: SessionGrant;
}

export interface DeleteAccountRequest {
  readonly loginKey: string;
}

export interface OkResponse {
  readonly ok: true;
}
