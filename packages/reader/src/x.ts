import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { cleanText, extractMeta, type PageMeta } from './meta';
import { excerpt, safely } from './result';
import { htmlToText, sanitizeHtml } from './sanitize';
import type { ReaderContent, ReaderIssue, ReaderResult } from './types';
import { resolveHttpUrl } from './url';

interface XOembed {
  html: string;
  authorName: string | null;
  authorUrl: string | null;
  url: string | null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Validates the shape of an untrusted oEmbed response (object or JSON string). */
function readOembed(value: unknown): XOembed | null {
  let data: unknown = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const html = optionalString(record.html);
  if (!html) return null;
  return {
    html,
    authorName: optionalString(record.author_name),
    authorUrl: optionalString(record.author_url),
    url: optionalString(record.url),
  };
}

/** Parses the English date of the oEmbed blockquote ("March 21, 2006") as `YYYY-MM-DD`. */
export function parseOembedDate(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^([A-Za-z]+) (\d{1,2}), (\d{4})$/);
  if (!match) return null;
  const [, monthName = '', day = '', year = ''] = match;
  const month = MONTHS.indexOf(monthName.toLowerCase()) + 1;
  const dayNumber = Number(day);
  if (month === 0 || dayNumber < 1 || dayNumber > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
}

function handleFrom(authorUrl: string | null): string | null {
  if (!authorUrl) return null;
  const path = resolveHttpUrl(authorUrl, 'https://x.com/');
  const handle = path ? new URL(path).pathname.split('/')[1] : undefined;
  return handle ? `@${handle}` : null;
}

function readTweet(
  oembed: XOembed,
  url: string,
): { content: ReaderContent; publishedAt: string | null } {
  const { doc } = parseHtmlPage(oembed.html, url);
  const blockquote = doc.querySelector('blockquote') ?? doc.body;
  const paragraph = blockquote.querySelector('p');
  const links = blockquote.querySelectorAll(':scope > a');
  const publishedAt = parseOembedDate(links[links.length - 1]?.textContent);
  const html = paragraph ? sanitizeHtml(paragraph.innerHTML, url) : '';
  const text = html ? htmlToText(html) : '';
  return {
    content: text ? { kind: 'tweet', html, text } : { kind: 'none', text: '' },
    publishedAt,
  };
}

const EMPTY_META: PageMeta = {
  title: null,
  description: null,
  author: null,
  siteName: null,
  imageUrl: null,
  canonicalUrl: null,
  publishedAt: null,
};

/**
 * Parses a post on X from the official oEmbed response (`publish.twitter.com/oembed`, requested
 * with `omit_script=1`; its script is never run) plus, optionally, the HTML of the post page for
 * the image (`og:image`), which oEmbed does not include.
 *
 * - Text, author and date come from oEmbed. The text is sanitized like any other HTML.
 * - If oEmbed is missing or invalid, the text falls back to `og:description` of the page.
 * - `oembed` is untrusted: an object or a JSON string; anything else degrades to the page metadata
 *   or to a minimal result.
 *
 * Throws `ReaderInputError` only for an invalid URL or a non-string `pageHtml`.
 */
export function parseXOembed(oembed: unknown, url: string, pageHtml?: string): ReaderResult {
  if (pageHtml !== undefined && typeof pageHtml !== 'string') {
    throw new ReaderInputError('pageHtml must be a string');
  }
  return safely(url, (href, source) => {
    const page = pageHtml ? parseHtmlPage(pageHtml, href) : null;
    const meta = page ? extractMeta(page.doc, page.baseUrl) : EMPTY_META;
    const data = readOembed(oembed);
    const issues: ReaderIssue[] = oembed != null && !data ? ['oembed_invalid'] : [];
    const tweet = data ? readTweet(data, href) : null;

    let content: ReaderContent = tweet?.content ?? { kind: 'none', text: '' };
    if (content.kind === 'none' && meta.description) {
      content = { kind: 'tweet', text: meta.description };
    }

    const author = cleanText(data?.authorName);
    const handle = handleFrom(data?.authorUrl ?? null);
    const fallbackTitle = author ? `${author}${handle ? ` (${handle})` : ''} on X` : null;

    return {
      source,
      url: href,
      canonicalUrl: resolveHttpUrl(data?.url, href) ?? meta.canonicalUrl ?? href,
      title: meta.title ?? fallbackTitle,
      description: meta.description ?? excerpt(content.text),
      author: author ?? meta.author,
      siteName: meta.siteName ?? 'X',
      imageUrl: meta.imageUrl,
      publishedAt: tweet?.publishedAt ?? meta.publishedAt,
      content,
      issues,
    };
  });
}
