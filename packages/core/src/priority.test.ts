import { describe, expect, it } from 'vitest';
import { PRIORITIES, isPriority } from './index';

describe('isPriority', () => {
  it('should accept every known priority', () => {
    expect(PRIORITIES.every((priority) => isPriority(priority))).toBe(true);
  });

  it('should reject an unknown string', () => {
    expect(isPriority('urgent')).toBe(false);
  });

  it('should reject a value that is not a string', () => {
    expect(isPriority(1)).toBe(false);
  });
});

describe('PRIORITIES', () => {
  it('should be ordered from most to least important', () => {
    expect(PRIORITIES).toEqual(['high', 'medium', 'low']);
  });
});
