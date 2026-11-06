import {
  MAX_EMAIL_LENGTH,
  SALT_BYTES,
  SENT_KEY_BYTES,
  WRAPPED_DATA_KEY_BYTES,
  assertKdfParams,
  fromBase64Url,
  normalizeEmail,
  type AccountSetup,
  type KdfParams,
  type PasswordSetup,
} from '@stash/core/protocol';
import { readBounded } from '../extract/safe-fetch';
import { ApiError, validationError } from './errors';

/** Largest JSON body accepted: a full account setup is well under 1 KiB. */
export const MAX_BODY_BYTES = 4096;

type Json = Record<string, unknown>;

/**
 * Reads a JSON object body of at most `maxBytes`, streaming and stopping at the limit.
 * The body must be declared `application/json`: any other type, `text/plain` above all, would
 * let another site's page send the request without a CORS preflight. Every route checks this
 * before counting the request, so a refused body costs no write.
 */
export async function readJsonBody(request: Request, maxBytes = MAX_BODY_BYTES): Promise<Json> {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'The body must be JSON', 415);
  }
  let bytes: Uint8Array;
  try {
    ({ bytes } = await readBounded(request, maxBytes, 'reject', new AbortController().signal));
  } catch {
    throw tooLarge();
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw validationError('Body must be JSON');
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw validationError('Body must be a JSON object');
  }
  return body as Json;
}

function tooLarge(): ApiError {
  return new ApiError('PAYLOAD_TOO_LARGE', 'Body too large', 413);
}

function object(value: unknown, field: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw validationError(`${field} must be an object`);
  }
  return value as Json;
}

/**
 * Normalises the email exactly as the clients do before binding it into the salt (trim, NFC,
 * lowercase), then checks its shape: something@something, no spaces, at most 254 characters.
 */
export function email(value: unknown): string {
  if (typeof value !== 'string') throw validationError('email must be a string');
  let normalized: string;
  try {
    normalized = normalizeEmail(value);
  } catch {
    throw validationError('email is required');
  }
  const at = normalized.lastIndexOf('@');
  if (
    normalized.length > MAX_EMAIL_LENGTH ||
    at < 1 ||
    at === normalized.length - 1 ||
    /\s/.test(normalized)
  ) {
    throw validationError('email is not valid');
  }
  return normalized;
}

/** Decodes a base64url field that must be exactly `length` bytes long. */
function fixedBytes(value: unknown, field: string, length: number): Uint8Array {
  let bytes: Uint8Array | null = null;
  if (typeof value === 'string') {
    try {
      bytes = fromBase64Url(value);
    } catch {
      bytes = null;
    }
  }
  if (bytes === null || bytes.length !== length) throw validationError(`${field} is not valid`);
  return bytes;
}

/** A login key or recovery auth key: 32 bytes in base64url. */
export function sentKey(value: unknown, field: string): Uint8Array {
  return fixedBytes(value, field, SENT_KEY_BYTES);
}

function kdf(value: unknown): KdfParams {
  try {
    assertKdfParams(value);
  } catch {
    throw validationError('kdf is not supported');
  }
  const { memoryKiB, iterations } = value;
  return { algorithm: 'argon2id', memoryKiB, iterations, parallelism: 1 };
}

/** A password setup, as `createAccountKeys` and `changePassword` produce it. */
export interface ParsedPasswordSetup {
  readonly salt: string;
  readonly kdf: KdfParams;
  readonly loginKey: Uint8Array;
  readonly wrappedDataKey: string;
}

export interface ParsedAccountSetup extends ParsedPasswordSetup {
  readonly recoveryAuthKey: Uint8Array;
  readonly recoveryWrappedDataKey: string;
}

export function passwordSetup(value: unknown): ParsedPasswordSetup {
  const keys = object(value, 'keys') as Partial<Record<keyof PasswordSetup, unknown>>;
  fixedBytes(keys.salt, 'keys.salt', SALT_BYTES);
  fixedBytes(keys.wrappedDataKey, 'keys.wrappedDataKey', WRAPPED_DATA_KEY_BYTES);
  return {
    salt: keys.salt as string,
    kdf: kdf(keys.kdf),
    loginKey: sentKey(keys.loginKey, 'keys.loginKey'),
    wrappedDataKey: keys.wrappedDataKey as string,
  };
}

export function accountSetup(value: unknown): ParsedAccountSetup {
  const keys = object(value, 'keys') as Partial<Record<keyof AccountSetup, unknown>>;
  fixedBytes(keys.recoveryWrappedDataKey, 'keys.recoveryWrappedDataKey', WRAPPED_DATA_KEY_BYTES);
  return {
    ...passwordSetup(keys),
    recoveryAuthKey: sentKey(keys.recoveryAuthKey, 'keys.recoveryAuthKey'),
    recoveryWrappedDataKey: keys.recoveryWrappedDataKey as string,
  };
}
