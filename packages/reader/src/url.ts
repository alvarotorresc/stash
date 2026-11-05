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
 * http(s), which drops `javascript:`, `data:`, `file:` and friends.
 */
export function resolveHttpUrl(value: string | null | undefined, base: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const resolved = new URL(trimmed, base);
    return HTTP_PROTOCOLS.has(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

/** Lowercased host without a trailing dot. */
export function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/\.$/, '');
}

/** True when `host` is `domain` or one of its subdomains. */
export function isHostOf(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}
