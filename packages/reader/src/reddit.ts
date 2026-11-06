import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { cleanText, toIsoDate } from './meta';
import { excerpt, minimalResult, safely } from './result';
import { htmlToText, sanitizeHtml } from './sanitize';
import type { ReaderContent, ReaderResult } from './types';
import { resolveHttpUrl, sameSiteCanonical } from './url';

function child(parent: Element | null | undefined, name: string): Element | null {
  if (!parent) return null;
  return Array.from(parent.children).find((element) => element.localName === name) ?? null;
}

function childText(parent: Element | null | undefined, name: string): string | null {
  return child(parent, name)?.textContent?.trim() || null;
}

/** `/u/name` → `u/name`. Deleted authors come as an empty or missing element. */
function cleanAuthor(value: string | null): string | null {
  return cleanText(value?.replace(/^\/u\//, 'u/'));
}

/**
 * Keeps only the body of the post. Reddit wraps it in `<div class="md">` and appends a localized
 * trailer ("submitted by … [link] [comments]") that is dropped by taking that div only. Link posts
 * have no such div and give no content.
 */
function readPostBody(escapedHtml: string | null, url: string): ReaderContent {
  if (!escapedHtml) return { kind: 'none', text: '' };
  const { doc } = parseHtmlPage(escapedHtml, url);
  const body = doc.querySelector('div.md');
  const html = body ? sanitizeHtml(body.innerHTML, url) : '';
  const text = html ? htmlToText(html) : '';
  return text ? { kind: 'post', html, text } : { kind: 'none', text: '' };
}

/**
 * Parses the Atom feed of a Reddit post (`…/comments/<id>/.rss`). The post is the entry whose id
 * starts with `t3_` (or the first entry); the rest are comments and are discarded. Missing
 * fields, such as a deleted author, become `null`.
 *
 * Throws `ReaderInputError` only for an invalid URL or a non-string `xml`.
 */
export function parseRedditRss(xml: string, url: string): ReaderResult {
  if (typeof xml !== 'string') throw new ReaderInputError('xml must be a string');
  return safely(url, (href, source) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) {
      return minimalResult(href, ['rss_invalid']);
    }
    const entries = Array.from(doc.getElementsByTagName('entry'));
    const entry =
      entries.find((element) => childText(element, 'id')?.startsWith('t3_')) ?? entries[0];
    if (!entry) {
      return {
        ...minimalResult(href, ['rss_no_entry']),
        title: cleanText(childText(doc.documentElement, 'title')),
        siteName: 'Reddit',
      };
    }

    const content = readPostBody(childText(entry, 'content'), href);
    const subreddit = child(entry, 'category')?.getAttribute('label') ?? null;
    return {
      source,
      url: href,
      canonicalUrl: sameSiteCanonical(
        resolveHttpUrl(child(entry, 'link')?.getAttribute('href'), href),
        href,
      ),
      title: cleanText(childText(entry, 'title')),
      description: excerpt(content.text) ?? cleanText(subreddit),
      author: cleanAuthor(childText(child(entry, 'author'), 'name')),
      siteName: 'Reddit',
      // The feed only has the subreddit's thumbnail, not one for the post.
      imageUrl: null,
      publishedAt: toIsoDate(childText(entry, 'published') ?? childText(entry, 'updated')),
      content,
      issues: content.kind === 'none' ? ['no_readable_content'] : [],
    };
  });
}
