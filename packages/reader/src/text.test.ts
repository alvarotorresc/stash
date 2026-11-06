import { describe, expect, it } from 'vitest';
import { normalizeText, truncate } from './text';

describe('normalizeText', () => {
  it('should collapse whitespace inside lines and drop empty lines', () => {
    expect(normalizeText('  a \t b \n\n  c  ')).toBe('a b\nc');
  });

  it('should remove control characters', () => {
    expect(normalizeText('bell\u0007 null\u0000 del\u007f c1\u0085x')).toBe('bell null del c1x');
  });

  it.each(['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '‎', '‏', '؜'])(
    'should remove the bidi control %j',
    (char) => {
      expect(normalizeText(`invoice${char}fdp.exe`)).toBe('invoicefdp.exe');
    },
  );

  it('should keep joiners used by emoji and scripts', () => {
    expect(normalizeText('👩‍💻 می‌خواهم')).toBe('👩‍💻 می‌خواهم');
  });
});

describe('truncate', () => {
  it('should leave short text as it is', () => {
    expect(truncate('abc', 3)).toBe('abc');
  });

  it('should cut long text and add an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
  });

  it('should not split a surrogate pair', () => {
    const out = truncate(`ab${'😀'.repeat(5)}`, 4);
    expect(out).toBe('ab…');
    expect(() => encodeURIComponent(out)).not.toThrow();
  });
});
