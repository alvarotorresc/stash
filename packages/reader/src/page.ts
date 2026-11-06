import { Readability } from '@mozilla/readability';
import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { cleanText, extractMeta, toIsoDate } from './meta';
import { safely } from './result';
import { htmlToText, sanitizeHtml } from './sanitize';
import type { ReaderContent, ReaderIssue, ReaderResult, Source } from './types';
import { sameSiteCanonical } from './url';
import { parseXOembed } from './x';

function readArticle(
  doc: Document,
  baseUrl: string,
  kind: 'article' | 'post',
): {
  content: ReaderContent;
  byline: string | null;
  excerpt: string | null;
  title: string | null;
  publishedAt: string | null;
  issues: ReaderIssue[];
} {
  // Readability mutates the document it reads; this one is a private parsed copy.
  const article = new Readability(doc).parse();
  const html = article?.content ? sanitizeHtml(article.content, baseUrl) : '';
  const text = html ? htmlToText(html) : '';
  const content: ReaderContent = text ? { kind, html, text } : { kind: 'none', text: '' };
  return {
    content,
    byline: cleanText(article?.byline),
    excerpt: cleanText(article?.excerpt, 1000),
    title: cleanText(article?.title),
    publishedAt: toIsoDate(article?.publishedTime),
    issues: text ? [] : ['no_readable_content'],
  };
}

function parseWithReadability(html: string, url: string, source: Source): ReaderResult {
  const { doc, baseUrl } = parseHtmlPage(html, url);
  const meta = extractMeta(doc, baseUrl);
  if (source === 'instagram') {
    // Instagram is preview only: no reader mode.
    return {
      source,
      url,
      canonicalUrl: sameSiteCanonical(meta.canonicalUrl, url),
      title: meta.title,
      description: meta.description,
      author: meta.author,
      siteName: meta.siteName ?? 'Instagram',
      imageUrl: meta.imageUrl,
      publishedAt: meta.publishedAt,
      content: { kind: 'none', text: '' },
      issues: [],
    };
  }
  const article = readArticle(doc, baseUrl, source === 'reddit' ? 'post' : 'article');
  return {
    source,
    url,
    canonicalUrl: sameSiteCanonical(meta.canonicalUrl, url),
    title: meta.title ?? article.title,
    description: meta.description ?? article.excerpt,
    author: meta.author ?? article.byline,
    siteName: meta.siteName ?? new URL(url).hostname.replace(/^www\./, ''),
    imageUrl: meta.imageUrl,
    publishedAt: meta.publishedAt ?? article.publishedAt,
    content: article.content,
    issues: article.issues,
  };
}

/**
 * Parses the HTML of a page (as returned by the proxy) into the common model.
 *
 * - `web` and `reddit`: metadata plus reader mode (Readability), sanitized.
 * - `x`: metadata only; the post text comes from `og:description`. Prefer `parseXOembed` when the
 *   oEmbed response is available.
 * - `instagram`: preview only (`content.kind = 'none'`).
 *
 * Needs a DOM (`DOMParser` and `window`): the PWA, the extension's pages and content scripts. It
 * does not work in a service worker. Throws `ReaderInputError` only for invalid input.
 */
export function parsePage(html: string, url: string): ReaderResult {
  if (typeof html !== 'string') throw new ReaderInputError('html must be a string');
  return safely(url, (href, source) =>
    source === 'x' ? parseXOembed(null, href, html) : parseWithReadability(html, href, source),
  );
}

/**
 * Parses an already loaded page, such as the tab open in the extension. The live document is
 * serialized and parsed again into an inert copy, so it is never modified and nothing on it runs.
 */
export function parseDocument(doc: Document, url: string): ReaderResult {
  const root = (doc as Partial<Document> | null)?.documentElement;
  if (!root) throw new ReaderInputError('doc must be a Document');
  return parsePage(root.outerHTML, url);
}
