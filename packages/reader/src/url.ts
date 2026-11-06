import { ReaderInputError } from './errors';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

/** Parses a caller-provided URL. Throws `ReaderInputError` unless it is an absolute http(s) URL. */
export function parseHttpUrl(value: unknown): URL {
  if (typeof value !== 'string') {
    throw new ReaderInputError('url must be a string');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ReaderInputError('url is not a valid absolute URL');
  }
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new ReaderInputError('url must use http or https');
  }
  return parsed;
}

/**
 * Resolves a URL found in untrusted content against `base`. Returns `null` unless the result is
 * http(s), which drops `javascript:`, `data:`, `file:` and friends. Without `base`, only absolute
 * URLs are accepted.
 */
export function resolveHttpUrl(value: string | null | undefined, base?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const resolved = new URL(trimmed, base);
    return HTTP_PROTOCOLS.has(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

/** IPv4 ranges that are not public: this network, private, CGNAT, loopback, link-local… */
const PRIVATE_IPV4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10
  [0x7f000000, 8], // 127.0.0.0/8
  [0xa9fe0000, 16], // 169.254.0.0/16
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15
  [0xe0000000, 3], // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved
];

function isPrivateIpv4(address: number): boolean {
  return PRIVATE_IPV4.some(
    ([network, bits]) => address >>> (32 - bits) === network >>> (32 - bits),
  );
}

function ipv4ToNumber(host: string): number | null {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!match) return null;
  return match.slice(1).reduce((total, part) => total * 256 + Number(part), 0);
}

function isPrivateIpv6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  // IPv4-mapped (`::ffff:a.b.c.d`) and IPv4-compatible addresses, as serialized by `URL`.
  const embedded = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (embedded) {
    const [, high = '0', low = '0'] = embedded;
    return isPrivateIpv4(parseInt(high, 16) * 0x10000 + parseInt(low, 16));
  }
  const first = parseInt(host.split(':')[0] || '0', 16);
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/**
 * True for `localhost` (and its subdomains) and for literal IP addresses that are not public:
 * loopback, private, link-local, unique local, multicast… `hostname` is `URL.hostname`, which
 * already normalizes forms such as `0x7f.1` or `2130706433` to `127.0.0.1`. Host names that only
 * resolve to such addresses through DNS are not detected; the proxy has to block those.
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.startsWith('[') && host.endsWith(']')) return isPrivateIpv6(host.slice(1, -1));
  const ipv4 = ipv4ToNumber(host);
  return ipv4 !== null && isPrivateIpv4(ipv4);
}

/**
 * Like `resolveHttpUrl`, but also drops URLs whose host is `localhost` or a non-public literal IP.
 * Used for image URLs, which the app may later ask the proxy to download.
 */
export function resolvePublicHttpUrl(
  value: string | null | undefined,
  base?: string,
): string | null {
  const resolved = resolveHttpUrl(value, base);
  return resolved && !isPrivateHost(new URL(resolved).hostname) ? resolved : null;
}

/** Lowercased host without a trailing dot. */
export function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

/** True when `host` is `domain` or one of its subdomains. */
export function isHostOf(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
