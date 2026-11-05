import { describe, expect, it } from 'vitest';
import { cleanText, toIsoDate } from './meta';

describe('cleanText', () => {
  it('should collapse whitespace and cap the length', () => {
    expect(cleanText(`  a\n  b  ${'c'.repeat(20)}`, 10)).toBe('a b ccccc…');
  });

  it.each([null, undefined, '', '   '])('should return null for %j', (value) => {
    expect(cleanText(value)).toBeNull();
  });
});

describe('toIsoDate', () => {
  it.each([
    ['2025-03-04', '2025-03-04'],
    ['2025-03-04T10:00:00+02:00', '2025-03-04T08:00:00.000Z'],
    ['not a date', null],
    [null, null],
  ])('should normalize %j to %j', (value, expected) => {
    expect(toIsoDate(value)).toBe(expected);
  });
});
