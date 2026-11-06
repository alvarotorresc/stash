import { Readability } from '@mozilla/readability';
import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { cleanText, extractMeta, toIsoDate } from './meta';
import { safely } from './result';
import {
  buildContent,
  exceedsInputLimit,
  exceedsStructureLimits,
  headOf,
  MAX_ELEMENTS,
} from './limits';
import { sanitizeHtml } from './sanitize';
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
  // Readability mutates the document it reads; this one is a private parsed copy. The element
  // limit is a second barrier: the page was measured before and Readability throws past it.
  const article = new Readability(doc, { maxElemsToParse: MAX_ELEMENTS }).parse();
  const html = article?.content ? sanitizeHtml(article.content, baseUrl) : '';
  const { content, issues } = buildContent(html, kind);
  return {
    content,
    byline: cleanText(article?.byline),
    excerpt: cleanText(article?.excerpt, 1000),
    title: cleanText(article?.title),
    publishedAt: toIsoDate(article?.publishedTime),
    issues: content.kind === 'none' ? ['no_readable_content'] : issues,
  };
}

function parseWithReadability(html: string, url: string, source: Source): ReaderResult {
  // Input over the size limit is not read: only the metadata at its start is.
  const oversized = exceedsInputLimit(html);
  const { doc, baseUrl } = parseHtmlPage(oversized ? headOf(html) : html, url);
  const meta = extractMeta(doc, baseUrl);
  const preview: ReaderResult = {
    source,
    url,
    canonicalUrl: sameSiteCanonical(meta.canonicalUrl, url),
    title: meta.title,
    description: meta.description,
    author: meta.author,
    siteName: meta.siteName ?? new URL(url).hostname.replace(/^www\./, ''),
    imageUrl: meta.imageUrl,
    publishedAt: meta.publishedAt,
    content: { kind: 'none', text: '' },
    issues: oversized ? ['too_large'] : [],
  };
  if (source === 'instagram') {
    // Instagram is preview only: no reader mode.
    return { ...preview, siteName: meta.siteName ?? 'Instagram' };
  }
  if (oversized || exceedsStructureLimits(doc.documentElement)) {
    return { ...preview, issues: ['too_large'] };
  }
  const article = readArticle(doc, baseUrl, source === 'reddit' ? 'post' : 'article');
  return {
    ...preview,
    title: meta.title ?? article.title,
    description: meta.description ?? article.excerpt,
    author: meta.author ?? article.byline,
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
 * - Over the limits (2 MiB of input, 20 000 elements or 100 levels of nesting): preview from the
 *   metadata, with the `too_large` issue. See `src/limits.ts`.
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
