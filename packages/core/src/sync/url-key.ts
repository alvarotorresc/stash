/**
 * The key used to tell whether two links are the same page. It is only for comparing: the URL
 * that gets saved is never changed.
 *
 * Two links share a key when they differ only in letter case of the scheme and host, the
 * `#fragment`, tracking parameters, trailing slashes in the path or a default port. Anything else
 * (another path, `www.`, any other parameter) makes them different links.
 */

/** Tracking parameters dropped on every site. `utm_*` is matched by prefix. */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'igsh', 'igshid']);

/** Sites where `si` is a share-tracking parameter; elsewhere it may identify the page. */
const SI_HOSTS = new Set(['youtu.be', 'youtube.com', 'open.spotify.com', 'spotify.link']);

function isTracking(name: string, host: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) return true;
  return lower === 'si' && SI_HOSTS.has(host.replace(/^(www|m|music)\./, ''));
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
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && !isTracking(pair.split('=')[0] ?? '', url.hostname));
  url.search = kept.join('&');
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}
