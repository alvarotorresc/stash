import { normalizeText } from './sanitize';
import { resolveHttpUrl } from './url';

export interface PageMeta {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  imageUrl: string | null;
  canonicalUrl: string | null;
  publishedAt: string | null;
}

const MAX_SHORT = 300;
const MAX_LONG = 1000;

/** Trims, collapses whitespace and caps the length of a value from untrusted content. */
export function cleanText(value: string | null | undefined, max = MAX_SHORT): string | null {
  if (!value) return null;
  const text = normalizeText(value.replace(/\n/g, ' '));
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Normalizes a date to ISO 8601, or `null` if it does not parse. */
export function toIsoDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function collectMeta(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const element of Array.from(doc.querySelectorAll('meta'))) {
    const key = (element.getAttribute('property') ?? element.getAttribute('name'))?.toLowerCase();
    const content = element.getAttribute('content');
    if (key && content && !map.has(key)) map.set(key, content);
  }
  return map;
}

function first(map: Map<string, string>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = map.get(key)?.trim();
    if (value) return value;
  }
  return null;
}

/** Reads Open Graph, Twitter card and standard metadata from a parsed page. */
export function extractMeta(doc: Document, baseUrl: string): PageMeta {
  const meta = collectMeta(doc);
  const author = first(meta, ['author', 'article:author', 'twitter:creator']);
  const canonical = doc.querySelector('link[rel~="canonical" i]')?.getAttribute('href');
  return {
    title: cleanText(
      first(meta, ['og:title', 'twitter:title']) ?? doc.querySelector('title')?.textContent,
    ),
    description: cleanText(
      first(meta, ['og:description', 'twitter:description', 'description']),
      MAX_LONG,
    ),
    // `article:author` is often a profile URL rather than a name.
    author: author && /^https?:\/\//i.test(author) ? null : cleanText(author),
    siteName: cleanText(first(meta, ['og:site_name', 'application-name'])),
    imageUrl: resolveHttpUrl(
      first(meta, [
        'og:image:secure_url',
        'og:image',
        'og:image:url',
        'twitter:image',
        'twitter:image:src',
      ]),
      baseUrl,
    ),
    canonicalUrl:
      resolveHttpUrl(canonical, baseUrl) ?? resolveHttpUrl(first(meta, ['og:url']), baseUrl),
    publishedAt: toIsoDate(
      first(meta, ['article:published_time', 'og:published_time', 'date', 'dc.date']),
    ),
  };
}
