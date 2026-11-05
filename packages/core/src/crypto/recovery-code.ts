import { concatBytes, randomBytes, type Bytes } from './bytes';
import { CryptoError } from './errors';

/**
 * Recovery code, version 1: 128 random bits plus a 12-bit checksum (the first 12 bits of
 * SHA-256 of the secret) make 140 bits, which are exactly 28 Crockford base32 characters,
 * shown as 7 groups of 4. The checksum catches typos before anything is sent to the server.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 16;
const CODE_LENGTH = 28;
const GROUP_LENGTH = 4;

function invalidCode(): CryptoError {
  return new CryptoError('INVALID_RECOVERY_CODE', 'Invalid recovery code');
}

async function checksum(secret: Bytes): Promise<Bytes> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
  return new Uint8Array([hash[0] as number, (hash[1] as number) & 0xf0]);
}

/** Formats a 16-byte secret as a recovery code. */
export async function encodeRecoveryCode(secret: Bytes): Promise<string> {
  const payload = concatBytes(secret, await checksum(secret));
  let characters = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of payload) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && characters.length < CODE_LENGTH) {
      bits -= 5;
      characters += ALPHABET[(buffer >> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  return (characters.match(new RegExp(`.{${GROUP_LENGTH}}`, 'g')) as string[]).join('-');
}

export async function generateRecoveryCode(): Promise<{ code: string; secret: Bytes }> {
  const secret = randomBytes(SECRET_BYTES);
  return { code: await encodeRecoveryCode(secret), secret };
}

/** Parses a typed recovery code, forgiving case, spaces, hyphens and O/I/L look-alikes. */
export async function parseRecoveryCode(input: string): Promise<Bytes> {
  const characters = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (characters.length !== CODE_LENGTH) throw invalidCode();

  const payload = new Uint8Array(SECRET_BYTES + 2);
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of characters) {
    const value = ALPHABET.indexOf(character);
    if (value === -1) throw invalidCode();
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      payload[offset++] = (buffer >> bits) & 0xff;
    }
    buffer &= (1 << bits) - 1;
  }
  // 140 bits fill 17 bytes and the high half of the last one.
  payload[offset] = buffer << (8 - bits);

  const secret = payload.slice(0, SECRET_BYTES);
  const expected = await checksum(secret);
  if (payload[SECRET_BYTES] !== expected[0] || payload[SECRET_BYTES + 1] !== expected[1]) {
    throw invalidCode();
  }
  return secret;
}
