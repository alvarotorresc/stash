import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import { minimalResult, safely } from './result';

describe('minimalResult', () => {
  it('should return the url and source with nothing else', () => {
    expect(minimalResult('https://x.com/a/status/1')).toEqual({
      source: 'x',
      url: 'https://x.com/a/status/1',
      canonicalUrl: 'https://x.com/a/status/1',
      title: null,
      description: null,
      author: null,
      siteName: null,
      imageUrl: null,
      publishedAt: null,
      content: { kind: 'none', text: '' },
      issues: [],
    });
  });

  it('should throw ReaderInputError for an invalid url', () => {
    expect(() => minimalResult('mailto:a@example.com')).toThrow(ReaderInputError);
  });
});

describe('safely', () => {
  it('should turn an unexpected error into a minimal result', () => {
    const result = safely('https://example.com/a', () => {
      throw new Error('boom');
    });
    expect([result.url, result.issues]).toEqual(['https://example.com/a', ['unexpected_error']]);
  });
});
