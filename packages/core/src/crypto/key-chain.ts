import { toBase64Url, type Bytes } from './bytes';
import { deriveAesKey, deriveBits, importKeyMaterial } from './kdf';

/** HKDF labels of the key chain, version 1. */
export const INFO = {
  loginKey: 'stash/v1/login-key',
  passwordKek: 'stash/v1/password-kek',
  recoveryAuthKey: 'stash/v1/recovery-auth-key',
  recoveryKek: 'stash/v1/recovery-kek',
} as const;

const SENT_KEY_BYTES = 32;
const KEK_USAGES: KeyUsage[] = ['wrapKey', 'unwrapKey'];

/** A key sent to the server (base64url) and a non-extractable key-encryption key. */
export interface SplitKeys {
  readonly sentKey: string;
  readonly kek: CryptoKey;
}

/** Splits uniform key material into a key to send and a KEK, then wipes the material. */
export async function splitKeyMaterial(
  ikm: Bytes,
  sentInfo: string,
  kekInfo: string,
): Promise<SplitKeys> {
  const base = await importKeyMaterial(ikm);
  ikm.fill(0);
  const [sentKey, kek] = await Promise.all([
    deriveBits(base, sentInfo, SENT_KEY_BYTES),
    deriveAesKey(base, kekInfo, KEK_USAGES),
  ]);
  const encoded = toBase64Url(sentKey);
  sentKey.fill(0);
  return { sentKey: encoded, kek };
}
