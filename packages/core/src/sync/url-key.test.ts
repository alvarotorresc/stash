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
