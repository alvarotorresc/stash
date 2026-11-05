import { describe, expect, it } from 'vitest';
import {
  expandIpv6,
  isAllowedTarget,
  isBlockedIpv6,
  parseAllowedTarget,
} from '../src/extract/url-guard';

describe('parseAllowedTarget', () => {
  it.each([
    'https://blog.example.org/post',
    'http://martinfowler.com/articles/microservices.html',
    'https://www.reddit.com/r/AskHistorians/comments/yopql1/x/',
    'https://news.example.org:443/a',
    'http://news.example.org:80/a',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
    'https://xn--bcher-kva.example.org/',
  ])('should allow the public url %s', (input) => {
    expect(parseAllowedTarget(input)).not.toBeNull();
  });

  it.each([
    ['not a url', 'not-a-url'],
    ['a relative url', '/api/health'],
    ['an empty string', ''],
  ])('should reject %s', (_label, input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it.each([
    'file:///etc/passwd',
    'ftp://ftp.example.org/file',
    'gopher://example.org/',
    'data:text/html,<p>hi</p>',
    'javascript:alert(1)',
    'ws://example.org/socket',
    'blob:https://example.org/uuid',
  ])('should reject the non-http scheme %s', (input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it.each([
    'https://example.org:8080/',
    'http://example.org:22/',
    'https://example.org:6379/',
    'http://example.org:0/',
  ])('should reject the non-standard port in %s', (input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it('should reject urls with credentials', () => {
    expect(parseAllowedTarget('https://user:pass@example.org/')).toBeNull();
    expect(parseAllowedTarget('https://user@example.org/')).toBeNull();
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST:80/',
    'http://localhost./',
    'http://api.localhost/',
    'http://printer.local/',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://router.home.arpa/',
    'http://nas.lan/',
    'http://intranet/',
    'http://metadata/',
    'http://site.test/',
    'https://stash.alvarotc.com/api/health',
    'https://STASH.alvarotc.com./api/health',
  ])('should reject the local or self hostname in %s', (input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it.each([
    'https://alvarotc.com/',
    'http://ALVAROTC.com./blog',
    'https://flame.alvarotc.com/',
    'https://quedamos.api.alvarotc.com/v1/health',
  ])('should reject every host of the own zone, such as %s', (input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it.each(['https://notalvarotc.com/', 'https://alvarotc.com.example.org/'])(
    'should allow %s, which only looks like the own zone',
    (input) => {
      expect(parseAllowedTarget(input)).not.toBeNull();
    },
  );

  it.each([
    'http://127.0.0.1/',
    'http://127.255.255.254/',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://10.255.255.255/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://192.0.0.1/',
    'http://198.18.0.1/',
    'http://224.0.0.1/',
    'http://255.255.255.255/',
  ])('should reject the private or reserved IPv4 %s', (input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it.each([
    ['decimal', 'http://2130706433/'],
    ['hexadecimal', 'http://0x7f.1/'],
    ['octal', 'http://0177.0.0.1/'],
    ['shortened', 'http://127.1/'],
    ['hex metadata', 'http://0xa9fea9fe/'],
  ])('should reject loopback and metadata written in %s form', (_form, input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });

  it('should still allow public neighbours of the private ranges', () => {
    expect(parseAllowedTarget('http://172.32.0.1/')).not.toBeNull();
    expect(parseAllowedTarget('http://11.0.0.1/')).not.toBeNull();
    expect(parseAllowedTarget('http://100.128.0.1/')).not.toBeNull();
  });

  it.each([
    ['loopback', 'http://[::1]/'],
    ['unspecified', 'http://[::]/'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
    ['IPv4-mapped private', 'http://[::ffff:10.0.0.1]/'],
    ['IPv4-mapped in hex', 'http://[::ffff:7f00:1]/'],
    ['IPv4-compatible', 'http://[::127.0.0.1]/'],
    ['NAT64', 'http://[64:ff9b::a9fe:a9fe]/'],
    ['unique local', 'http://[fd00::1]/'],
    ['unique local fc', 'http://[fc00::1]/'],
    ['link-local', 'http://[fe80::1]/'],
    ['site-local', 'http://[fec0::1]/'],
    ['multicast', 'http://[ff02::1]/'],
    ['6to4', 'http://[2002:7f00:1::1]/'],
    ['Teredo', 'http://[2001:0:4136:e378::1]/'],
    ['documentation', 'http://[2001:db8::1]/'],
  ])('should reject the IPv6 %s address', (_label, input) => {
    expect(parseAllowedTarget(input)).toBeNull();
  });
});

describe('isAllowedTarget', () => {
  it('should reject a url whose hostname is empty', () => {
    expect(isAllowedTarget(new URL('http://./'))).toBe(false);
  });
});

describe('expandIpv6', () => {
  it('should expand compressed and full forms', () => {
    expect(expandIpv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIpv6('2606:4700::1111')).toEqual([0x2606, 0x4700, 0, 0, 0, 0, 0, 0x1111]);
    expect(expandIpv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it.each(['1::2::3', '1:2:3', 'g::1', '1:2:3:4::5:6:7:8', '12345::1'])(
    'should return null for the malformed address %s',
    (address) => {
      expect(expandIpv6(address)).toBeNull();
    },
  );

  it('should treat malformed addresses as blocked', () => {
    expect(isBlockedIpv6('1::2::3')).toBe(true);
  });
});
