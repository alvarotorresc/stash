import { CryptoError } from './errors';

const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict decoder: url-safe alphabet, no padding and canonical trailing bits only. */
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL.test(text) || text.length % 4 === 1) {
    throw new CryptoError('INVALID_INPUT', 'Invalid base64url');
  }
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (toBase64Url(bytes) !== text) {
    throw new CryptoError('INVALID_INPUT', 'Invalid base64url');
  }
  return bytes;
}

/**
 * Compares two byte arrays in time that depends only on their length, which is not secret.
 * Meant for comparing hashes of login and recovery keys on the server.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= (a[index] as number) ^ (b[index] as number);
  }
  return difference === 0;
}
