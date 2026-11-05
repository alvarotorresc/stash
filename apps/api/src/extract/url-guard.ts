/**
 * SSRF guard for the extraction proxy: decides whether the Worker may request a URL.
 *
 * It works on the URL as normalised by the WHATWG parser, never on the raw string, so alternative
 * spellings of an address (`2130706433`, `0x7f.1`, `0177.0.0.1`, `[::ffff:127.0.0.1]`) are caught
 * in their canonical form.
 *
 * Limit: Workers does not expose DNS resolution, so a public hostname whose DNS points to a private
 * address cannot be detected here. Requests leave from the Cloudflare network, which has no access
 * to a private network of ours; the guard covers addresses and names that are local by definition.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
/** `URL.port` is '' when the port is the default one of the scheme. */
const ALLOWED_PORTS = new Set(['', '80', '443']);

/**
 * The own zone, subdomains included: the proxy must never request its own API nor any other
 * service of the zone, so it cannot be used to reach them with the identity of the app.
 */
const SELF_HOSTNAMES = ['alvarotc.com'];

/** Names that are local by definition (RFC 6761, RFC 8375 and common private suffixes). */
const LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'arpa',
  'test',
  'invalid',
  'example',
];

type Cidr4 = readonly [base: string, prefix: number];

/** Every IPv4 range that is not public unicast. */
const BLOCKED_IPV4: readonly Cidr4[] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved and broadcast
];

const IPV4_PATTERN = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function inCidr4(address: number, [base, prefix]: Cidr4): boolean {
  const size = 2 ** (32 - prefix);
  const start = ipv4ToNumber(base);
  return address >= start && address < start + size;
}

export function isBlockedIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  return BLOCKED_IPV4.some((cidr) => inCidr4(value, cidr));
}

/**
 * Expands a canonical IPv6 address (as serialised by the URL parser: lower case, hexadecimal
 * groups, at most one `::`) to its 8 groups. Returns null if it is not in that form.
 */
export function expandIpv6(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const groups = part.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => parseInt(group, 16));
  };
  const head = parse(halves[0]);
  const tail = parse(halves[1]);
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

/**
 * Allow-list: only global unicast (`2000::/3`), minus the blocks that embed or tunnel IPv4 or are
 * reserved for documentation. Everything else (loopback, unspecified, IPv4-mapped, NAT64, ULA,
 * link-local, multicast...) is outside `2000::/3` and therefore rejected.
 */
export function isBlockedIpv6(address: string): boolean {
  const groups = expandIpv6(address);
  if (!groups) return true;
  const [first = 0, second = 0] = groups;
  if ((first & 0xe000) !== 0x2000) return true; // not 2000::/3
  if (first === 0x2002) return true; // 6to4, embeds IPv4
  if (first === 0x2001 && second < 0x0200) return true; // 2001::/23 IETF, includes Teredo
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  return false;
}

function isLocalHostname(hostname: string): boolean {
  if (!hostname.includes('.')) return true; // single label: never a public site
  return LOCAL_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function isSelfHostname(hostname: string): boolean {
  return SELF_HOSTNAMES.some((self) => hostname === self || hostname.endsWith(`.${self}`));
}

/** Returns true when the Worker may request this URL. */
export function isAllowedTarget(url: URL): boolean {
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return false;
  if (!ALLOWED_PORTS.has(url.port)) return false;
  if (url.username !== '' || url.password !== '') return false;

  // A trailing dot is the same name for DNS (`localhost.` is `localhost`).
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '') return false;

  if (hostname.startsWith('[')) return !isBlockedIpv6(hostname.slice(1, -1));
  if (IPV4_PATTERN.test(hostname)) return !isBlockedIpv4(hostname);
  return !isLocalHostname(hostname) && !isSelfHostname(hostname);
}

/** Parses and checks a URL given by the client. Returns null if it cannot be requested. */
export function parseAllowedTarget(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    // Invalid URL: the caller answers a generic error; the input is never echoed nor logged.
    return null;
  }
  return isAllowedTarget(url) ? url : null;
}
