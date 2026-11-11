import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import { detectSource, isShortLink } from './source';

describe('detectSource', () => {
  it.each([
    ['https://www.reddit.com/r/example/comments/abc123/a_title/', 'reddit'],
    ['https://old.reddit.com/r/example/', 'reddit'],
    ['https://redd.it/abc123', 'reddit'],
    ['https://x.com/example/status/20', 'x'],
    ['https://mobile.twitter.com/example/status/20', 'x'],
    ['https://TWITTER.COM./example', 'x'],
    ['https://www.instagram.com/p/abc/', 'instagram'],
    ['https://instagr.am/p/abc/', 'instagram'],
    ['https://www.tiktok.com/@user/video/7378294254344342827', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc123/', 'tiktok'],
    ['https://m.tiktok.com/v/7378294254344342827', 'tiktok'],
    ['https://blog.example.com/post', 'web'],
    ['https://t.co/abc', 'web'],
  ])('should detect %s as %s', (url, source) => {
    expect(detectSource(url)).toBe(source);
  });

  it.each([
    'https://evilreddit.com/r/x',
    'https://reddit.com.evil.example/r/x',
    'https://notx.com/',
    'https://nottiktok.com/@a/video/1',
    'https://tiktok.com.evil.example/@a/video/1',
  ])('should not match a look-alike host such as %s', (url) => {
    expect(detectSource(url)).toBe('web');
  });

  it.each(['not a url', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com/'])(
    'should throw ReaderInputError when the url is %s',
    (url) => {
      expect(() => detectSource(url)).toThrow(ReaderInputError);
    },
  );

  it('should throw ReaderInputError when the url is not a string', () => {
    expect(() => detectSource(42 as unknown as string)).toThrow(ReaderInputError);
  });
});

describe('isShortLink', () => {
  it.each([
    ['https://t.co/abc', true],
    ['https://redd.it/abc123', true],
    ['https://www.reddit.com/r/example/s/AbCdEf', true],
    ['https://www.reddit.com/r/example/comments/abc123/', false],
    ['https://i.redd.it/image.png', false],
    ['https://x.com/example/status/20', false],
    ['https://vm.tiktok.com/ZMabc123/', true],
    ['https://vt.tiktok.com/ZSabc123/', true],
    ['https://www.tiktok.com/t/ZPabc123/', true],
    ['https://www.tiktok.com/@user/video/7378294254344342827', false],
    ['https://www.tiktok.com/@user', false],
  ])('should return the right answer for %s', (url, expected) => {
    expect(isShortLink(url)).toBe(expected);
  });
});
