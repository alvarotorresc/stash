import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeRecoveryCode, generateRecoveryCode, parseRecoveryCode } from './recovery-code';

const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/;
// 0x08 repeated encodes to a code that contains both 0 and 1.
const fixedSecret = new Uint8Array(16).fill(0x08);
const invalidCode = expect.objectContaining({ code: 'INVALID_RECOVERY_CODE' });

describe('generateRecoveryCode', () => {
  it('should format 28 Crockford base32 characters in groups of four', async () => {
    const { code } = await generateRecoveryCode();

    expect(code).toMatch(CODE_FORMAT);
  });

  it('should carry a 128-bit secret', async () => {
    const { secret } = await generateRecoveryCode();

    expect(secret).toHaveLength(16);
  });

  it('should generate a different code each time', async () => {
    const [first, second] = await Promise.all([generateRecoveryCode(), generateRecoveryCode()]);

    expect(first.code).not.toBe(second.code);
  });
});

describe('parseRecoveryCode', () => {
  it('should return the secret of a generated code', async () => {
    const { code, secret } = await generateRecoveryCode();

    expect(await parseRecoveryCode(code)).toEqual(secret);
  });

  it('should ignore case, spaces and hyphens', async () => {
    const code = await encodeRecoveryCode(fixedSecret);
    const typed = ` ${code.toLowerCase().replace(/-/g, ' ')} `;

    expect(await parseRecoveryCode(typed)).toEqual(fixedSecret);
  });

  it('should read O as 0 and I or L as 1', async () => {
    const code = await encodeRecoveryCode(fixedSecret);
    const misread = code
      .replace(/0/g, 'O')
      .replace(/1/g, (_, offset: number) => (offset % 2 === 0 ? 'I' : 'l'));

    expect({ misread: /[OIl]/.test(misread), secret: await parseRecoveryCode(misread) }).toEqual({
      misread: true,
      secret: fixedSecret,
    });
  });

  it('should reject a code with any single character mistyped', async () => {
    const characters = (await encodeRecoveryCode(fixedSecret)).replace(/-/g, '');

    const results = await Promise.allSettled(
      Array.from(characters, (character, index) => {
        const replacement = character === 'X' ? 'Y' : 'X';
        return parseRecoveryCode(
          characters.slice(0, index) + replacement + characters.slice(index + 1),
        );
      }),
    );

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
  });

  it.each([
    ['too short', 'ABCD-EFGH'],
    ['too long', `${'0'.repeat(28)}0`],
    ['a character outside the alphabet', `U${'0'.repeat(27)}`],
    ['punctuation', `!${'0'.repeat(27)}`],
    ['empty', ''],
  ])('should throw INVALID_RECOVERY_CODE when the code is %s', async (_, input) => {
    await expect(parseRecoveryCode(input)).rejects.toEqual(invalidCode);
  });
});

describe('working buffers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Records every 18-byte buffer (secret plus checksum) wiped with zeros. */
  function watchWipes(): Uint8Array[] {
    const wiped: Uint8Array[] = [];
    const fill = Uint8Array.prototype.fill;
    vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (
      this: Uint8Array,
      ...args: Parameters<Uint8Array['fill']>
    ) {
      const result = fill.apply(this, args);
      if (args[0] === 0 && this.length === 18) wiped.push(this);
      return result;
    });
    return wiped;
  }

  it('should wipe the secret-plus-checksum payload after encoding', async () => {
    const wiped = watchWipes();

    await encodeRecoveryCode(fixedSecret);

    expect(wiped.length === 1 && wiped[0]?.every((byte) => byte === 0)).toBe(true);
  });

  it('should wipe the decoded payload after parsing, also when the checksum fails', async () => {
    const code = await encodeRecoveryCode(fixedSecret);
    const wiped = watchWipes();

    await parseRecoveryCode(code);
    await parseRecoveryCode(code.replace(/^./, code[0] === 'A' ? 'B' : 'A')).catch(() => {});

    expect(wiped).toHaveLength(2);
  });
});
