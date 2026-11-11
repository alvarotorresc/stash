import { describe, expect, it } from 'vitest';
import { urlKey } from './url-key';

describe('urlKey', () => {
  it.each([
    ['HTTPS://Example.COM/Path', 'https://example.com/Path'],
    ['https://example.com/a#section', 'https://example.com/a'],
    ['https://example.com/a?utm_source=x&utm_medium=y&id=3', 'https://example.com/a?id=3'],
    ['https://example.com/a?fbclid=1&gclid=2&igsh=3&igshid=4', 'https://example.com/a'],
    ['https://example.com/a/', 'https://example.com/a'],
    ['https://example.com/a///', 'https://example.com/a'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com', 'https://example.com/'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80/a', 'http://example.com/a'],
    ['https://youtu.be/abc?si=tracking', 'https://youtu.be/abc'],
    ['https://www.youtube.com/watch?v=abc&si=tracking', 'https://www.youtube.com/watch?v=abc'],
    ['https://open.spotify.com/track/1?si=tracking', 'https://open.spotify.com/track/1'],
  ])('should reduce %s to %s', (input, expected) => {
    expect(urlKey(input)).toBe(expected);
  });

  it.each([
    ['https://x.com/ana/status/1?s=20&t=AbC_dEf', 'https://x.com/ana/status/1'],
    ['https://twitter.com/ana/status/1?s=20&t=AbC', 'https://x.com/ana/status/1'],
    ['https://mobile.twitter.com/ana/status/1', 'https://x.com/ana/status/1'],
    ['https://www.x.com/ana/status/1/', 'https://x.com/ana/status/1'],
    ['https://www.twitter.com/ana/status/1?s=1', 'https://x.com/ana/status/1'],
    ['https://x.com/i/article/99?s=3&t=z', 'https://x.com/i/article/99'],
  ])('should treat the X link %s as %s', (input, expected) => {
    expect(urlKey(input)).toBe(expected);
  });

  it('should keep other parameters of X and "s" or "t" elsewhere', () => {
    expect(urlKey('https://x.com/search?q=a&s=typed')).toBe('https://x.com/search?q=a');
    expect(urlKey('https://example.com/a?s=1&t=2')).toBe('https://example.com/a?s=1&t=2');
  });

  it.each([
    [
      'https://www.tiktok.com/@ana/video/7?_r=1&_t=ZN-8x&is_from_webapp=1&sender_device=pc&share_app_id=1233&share_link_id=ab&u_code=c&timestamp=9&social_sharing=1&utm_source=copy',
      'https://www.tiktok.com/@ana/video/7',
    ],
    ['https://vm.tiktok.com/ZMabc/?_r=1&_t=z', 'https://vm.tiktok.com/ZMabc'],
    ['https://www.tiktok.com/@ana/video/7?lang=es', 'https://www.tiktok.com/@ana/video/7?lang=es'],
  ])('should drop the share parameters of TikTok in %s', (input, expected) => {
    expect(urlKey(input)).toBe(expected);
  });

  it('should drop the share parameters of Instagram and Reddit but keep the slide index', () => {
    expect(urlKey('https://www.instagram.com/p/abc/?igsh=x&img_index=2')).toBe(
      'https://www.instagram.com/p/abc?img_index=2',
    );
    expect(
      urlKey('https://www.reddit.com/r/a/comments/1/t/?share_id=x&rdt=5&ref=share&ref_source=link'),
    ).toBe('https://www.reddit.com/r/a/comments/1/t');
    expect(urlKey('https://example.com/a?share_id=1&rdt=2&_r=3')).toBe(
      'https://example.com/a?share_id=1&rdt=2&_r=3',
    );
  });

  it('should keep the parameters that identify the page, in their order', () => {
    expect(urlKey('https://example.com/s?b=2&a=1&utm_campaign=z')).toBe(
      'https://example.com/s?b=2&a=1',
    );
  });

  it('should keep "si" outside the sites where it is a tracking parameter', () => {
    expect(urlKey('https://example.com/a?si=5')).toBe('https://example.com/a?si=5');
  });

  it('should match the same link written in different ways', () => {
    expect(urlKey('https://Example.com/a/?utm_source=x#top')).toBe(urlKey('https://example.com/a'));
  });

  it.each([
    ['https://example.com/a', 'https://example.com/b'],
    ['https://example.com/a', 'http://example.com/a'],
    ['https://example.com/a', 'https://www.example.com/a'],
    ['https://example.com/a?id=1', 'https://example.com/a?id=2'],
    ['https://example.com/a', 'https://example.com/A'],
    ['https://example.com:8080/a', 'https://example.com/a'],
  ])('should tell %s and %s apart', (first, second) => {
    expect(urlKey(first)).not.toBe(urlKey(second));
  });

  it('should return the text unchanged when it is not a URL', () => {
    expect(urlKey('not a url')).toBe('not a url');
  });
});
