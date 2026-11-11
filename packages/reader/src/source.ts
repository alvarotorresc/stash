import type { Source } from './types';
import { isHostOf, normalizedHost, parseHttpUrl } from './url';

const SOURCE_DOMAINS: ReadonlyArray<readonly [Source, readonly string[]]> = [
  ['reddit', ['reddit.com', 'redd.it']],
  ['x', ['x.com', 'twitter.com']],
  ['instagram', ['instagram.com', 'instagr.am']],
  ['tiktok', ['tiktok.com']],
];

/**
 * Detects the source of a link from its host, subdomains included (`old.reddit.com`,
 * `mobile.twitter.com`…). Anything else is `web`. Throws `ReaderInputError` for a URL that is not
 * http(s).
 */
export function detectSource(url: string): Source {
  const host = normalizedHost(parseHttpUrl(url));
  for (const [source, domains] of SOURCE_DOMAINS) {
    if (domains.some((domain) => isHostOf(host, domain))) return source;
  }
  return 'web';
}

/**
 * True for short links whose target cannot be known without following a redirect over the network:
 * - `t.co/<code>` (X): the target can be any site, so `detectSource` returns `web`.
 * - `redd.it/<id>` (Reddit).
 * - `reddit.com/r/<sub>/s/<code>` (Reddit share links from the mobile app).
 * - `vm.tiktok.com/<code>`, `vt.tiktok.com/<code>` and `tiktok.com/t/<code>` (TikTok share links).
 *
 * The proxy must resolve these first and the result be parsed with the final URL. Generic
 * shorteners (bit.ly and the like) are not detected: they are parsed as whatever page they serve.
 */
export function isShortLink(url: string): boolean {
  const parsed = parseHttpUrl(url);
  const host = normalizedHost(parsed);
  if (host === 't.co' || host === 'redd.it' || host === 'www.redd.it') return true;
  if (host === 'vm.tiktok.com' || host === 'vt.tiktok.com') return true;
  if (isHostOf(host, 'tiktok.com') && /^\/t\/[^/]+/.test(parsed.pathname)) return true;
  return isHostOf(host, 'reddit.com') && /^\/r\/[^/]+\/s\/[^/]+/.test(parsed.pathname);
}
