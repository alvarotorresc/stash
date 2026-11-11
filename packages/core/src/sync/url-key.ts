/**
 * The key used to tell whether two links are the same page. It is only for comparing: the URL
 * that gets saved is never changed.
 *
 * Two links share a key when they differ only in letter case of the scheme and host, the
 * `#fragment`, tracking and share parameters, trailing slashes in the path or a default port. On
 * X, `x.com`, `twitter.com`, `mobile.twitter.com` and their `www.` form are the same site. Anything
 * else (another path, `www.`, any other parameter) makes them different links.
 */

/** Tracking parameters dropped on every site. `utm_*` is matched by prefix. */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igsh', 'igshid']);

/** Sites where `si` is a share-tracking parameter; elsewhere it may identify the page. */
const SI_HOSTS = new Set(['youtu.be', 'youtube.com', 'open.spotify.com', 'spotify.link']);

/** The share sheet of the X app adds `s` (the platform) and `t` (a per-share token). */
const X_PARAMS = new Set(['s', 't']);
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com']);

/** Share parameters of TikTok; `share_*` is matched by prefix. */
const TIKTOK_PARAMS = new Set([
  '_r',
  '_t',
  '_d',
  'is_from_webapp',
  'sender_device',
  'u_code',
  'timestamp',
  'social_sharing',
  'checksum',
  'tt_from',
]);

/** Share parameters of Reddit. */
const REDDIT_PARAMS = new Set(['share_id', 'rdt', 'ref', 'ref_source']);

/** The host without the prefixes that only choose a version of the same site. */
function bareHost(host: string): string {
  return host.replace(/^(www|m|music)\./, '');
}

function isTracking(name: string, host: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) return true;
  const bare = bareHost(host);
  if (lower === 'si') return SI_HOSTS.has(bare);
  if (X_HOSTS.has(host)) return X_PARAMS.has(lower);
  if (bare === 'tiktok.com' || bare.endsWith('.tiktok.com')) {
    return TIKTOK_PARAMS.has(lower) || lower.startsWith('share_');
  }
  if (bare === 'reddit.com' || bare === 'redd.it') return REDDIT_PARAMS.has(lower);
  return false;
}

/** The comparison key of a link; text that is not a URL is returned as it came. */
export function urlKey(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return value;
  }
  // The URL parser already lowercases scheme and host and drops default ports.
  url.hash = '';
  // X answers on three hosts for the same post.
  if (X_HOSTS.has(url.hostname.replace(/^www\./, ''))) url.hostname = 'x.com';
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && !isTracking(pair.split('=')[0] ?? '', url.hostname));
  url.search = kept.join('&');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
