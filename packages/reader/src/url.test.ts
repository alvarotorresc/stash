import { describe, expect, it } from 'vitest';
import { isPrivateHost, resolvePublicHttpUrl, sameSiteCanonical } from './url';

const BASE = 'https://blog.example.com/posts/one';

describe('isPrivateHost', () => {
  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://127.0.0.1:8080/admin',
    'http://127.1/',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://127.0.0.1./',
    'http://0.0.0.0/',
    'http://10.1.2.3/',
    'http://100.64.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
    'http://[::1]/',
    'http://[::]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:10.0.0.1]/',
  ])('should flag %s', (url) => {
    expect(isPrivateHost(new URL(url).hostname)).toBe(true);
  });

  it.each([
    'https://example.com/',
    'https://localhost.example.com/',
    'http://8.8.8.8/',
    'http://172.32.0.1/',
    'http://100.128.0.1/',
    'http://[2606:4700::1111]/',
    'http://[::ffff:8.8.8.8]/',
  ])('should not flag %s', (url) => {
    expect(isPrivateHost(new URL(url).hostname)).toBe(false);
  });
});

describe('resolvePublicHttpUrl', () => {
  it('should resolve a public url against the base', () => {
    expect(resolvePublicHttpUrl('/img/a.png', BASE)).toBe('https://blog.example.com/img/a.png');
  });

  it.each(['http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/x', 'javascript:x'])(
    'should drop %s',
    (value) => {
      expect(resolvePublicHttpUrl(value, BASE)).toBeNull();
    },
  );

  it('should only accept absolute urls without a base', () => {
    expect([
      resolvePublicHttpUrl('/img/a.png'),
      resolvePublicHttpUrl('https://cdn.example.com/a.png'),
    ]).toEqual([null, 'https://cdn.example.com/a.png']);
  });
});

describe('sameSiteCanonical', () => {
  const URL_ = 'https://blog.example.com/posts/one';

  it.each([
    'https://blog.example.com/posts/one-canonical',
    'https://example.com/posts/one',
    'https://www.blog.example.com/posts/one',
    'http://BLOG.example.com./posts/one',
  ])('should keep the canonical %s on the same site', (canonical) => {
    expect(sameSiteCanonical(canonical, URL_)).toBe(canonical);
  });

  it.each([
    'https://paypal.com/login',
    'https://shop.example.com/x',
    'https://example.com.evil.net/',
    'https://com/',
  ])('should fall back to the url for %s', (canonical) => {
    expect(sameSiteCanonical(canonical, URL_)).toBe(URL_);
  });

  it('should fall back to the url when there is no canonical', () => {
    expect(sameSiteCanonical(null, URL_)).toBe(URL_);
  });
});
