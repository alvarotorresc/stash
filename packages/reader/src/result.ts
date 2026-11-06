import { cleanText } from './meta';
import { detectSource } from './source';
import type { ReaderIssue, ReaderResult, Source } from './types';
import { parseHttpUrl } from './url';

/**
 * The least a saved link always has, so a save is never lost: its URL and source, with no
 * preview or content.
 * Throws `ReaderInputError` for a URL that is not http(s).
 */
export function minimalResult(url: string, issues: ReaderIssue[] = []): ReaderResult {
  const href = parseHttpUrl(url).href;
  return {
    source: detectSource(href),
    url: href,
    canonicalUrl: href,
    title: null,
    description: null,
    author: null,
    siteName: null,
    imageUrl: null,
    publishedAt: null,
    content: { kind: 'none', text: '' },
    issues,
  };
}

/**
 * Validates the URL (throws on invalid input), then runs `parse`. Anything `parse` throws is turned
 * into a minimal result with the `unexpected_error` issue: callers never get an exception from bad
 * network data.
 */
export function safely(url: string, parse: (href: string, source: Source) => ReaderResult) {
  const fallback = minimalResult(url);
  try {
    return parse(fallback.url, fallback.source);
  } catch {
    return { ...fallback, issues: ['unexpected_error'] } satisfies ReaderResult;
  }
}

/** Short excerpt of a text, for the description of sources that have none. */
export function excerpt(text: string, max = 300): string | null {
  return cleanText(text, max);
}
