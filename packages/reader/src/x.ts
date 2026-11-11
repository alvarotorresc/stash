import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { cleanText, extractMeta, type PageMeta } from './meta';
import { excerpt, safely } from './result';
import { detectSource } from './source';
import { buildContent, exceedsInputLimit, exceedsStructureLimits, headOf } from './limits';
import { sanitizeHtml } from './sanitize';
import type { ReaderContent, ReaderIssue, ReaderResult } from './types';
import { resolveHttpUrl, sameSiteCanonical } from './url';

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

/** The link t.co puts at the end of a post that has media: "pic.twitter.com/…". */
const MEDIA_LINK_TEXT = /^pic\.(?:twitter|x)\.com\//i;

/** Longest title taken from the text of a post. */
const MAX_TITLE = 120;

function readTweet(
  oembed: XOembed,
  url: string,
): { content: ReaderContent; publishedAt: string | null; issues: ReaderIssue[] } {
  const { doc } = parseHtmlPage(oembed.html, url);
  if (exceedsStructureLimits(doc.documentElement)) {
    return { content: { kind: 'none', text: '' }, publishedAt: null, issues: ['too_large'] };
  }
  const blockquote = doc.querySelector('blockquote') ?? doc.body;
  const paragraph = blockquote.querySelector('p');
  const links = blockquote.querySelectorAll(':scope > a');
  const publishedAt = parseOembedDate(links[links.length - 1]?.textContent);
  for (const link of Array.from(paragraph?.querySelectorAll('a') ?? [])) {
    if (MEDIA_LINK_TEXT.test(link.textContent?.trim() ?? '')) link.remove();
  }
  const html = paragraph ? sanitizeHtml(paragraph.innerHTML, url) : '';
  return { ...buildContent(html, 'tweet'), publishedAt };
}

/** True when the oEmbed response (JSON string or its `html` field) is over the input limit. */
function isOversizedOembed(value: unknown): boolean {
  if (typeof value === 'string') return exceedsInputLimit(value);
  const html = (value as { html?: unknown } | null)?.html;
  return typeof html === 'string' && exceedsInputLimit(html);
}

/**
 * The post URL from oEmbed, only when it is on X itself. `x.com` and `twitter.com` count as the same
 * site here, since oEmbed often answers with one for a link saved with the other.
 */
function oembedCanonical(value: string | null | undefined, url: string): string | null {
  const resolved = resolveHttpUrl(value, url);
  return resolved && detectSource(resolved) === 'x' ? resolved : null;
}

/**
 * The image of the page, unless it is the author's avatar: X puts it in `og:image` when the post
 * has no media, and a small avatar says nothing about the post.
 */
function postImage(imageUrl: string | null): string | null {
  return imageUrl && !new URL(imageUrl).pathname.includes('/profile_images/') ? imageUrl : null;
}

/** A web address; t.co shortens every link in a post, so a link-only post is only these. */
const URL_TEXT = /https?:\/\/\S+/gi;

const HAS_LINK = /https?:\/\//i;

/** Fewer letters and digits than this, once links are removed, is "no text". */
const MIN_TEXT = 3;

/** True when the text has something to read besides links. */
function hasText(text: string | null | undefined): text is string {
  return !!text && text.replace(URL_TEXT, '').replace(/[^\p{L}\p{N}]/gu, '').length >= MIN_TEXT;
}

const CARD_TITLE = /^.+? on X:\s*["“”«](.+?)["“”»]?\s*(?:\/\s*X)?$/su;

/**
 * The title of the article or card a post links to. X puts it in the title of the page as
 * `Name on X: "Title" / X`; the prefix, the quotes and the suffix are not part of it. A page that
 * only says "Name (@handle) on X" has none.
 */
function cardTitle(doc: Document | undefined): string | null {
  if (!doc) return null;
  const candidates = [
    doc.querySelector('meta[property="og:title" i]')?.getAttribute('content'),
    doc.querySelector('meta[name="twitter:title" i]')?.getAttribute('content'),
    doc.querySelector('title')?.textContent,
  ];
  for (const candidate of candidates) {
    const title = cleanText(candidate?.match(CARD_TITLE)?.[1]);
    if (hasText(title)) return title;
  }
  return null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
 * - Over the size limit (2 MiB), the oEmbed response is ignored and the page only gives the
 *   metadata at its start; the result records `too_large`.
 *
 * Throws `ReaderInputError` only for an invalid URL or a non-string `pageHtml`.
 */
export function parseXOembed(oembed: unknown, url: string, pageHtml?: string): ReaderResult {
  if (pageHtml !== undefined && typeof pageHtml !== 'string') {
    throw new ReaderInputError('pageHtml must be a string');
  }
  return safely(url, (href, source) => {
    // Over the size limit, the page is only read for the metadata at its start and the oEmbed
    // response is not read at all.
    const pageOversized = pageHtml ? exceedsInputLimit(pageHtml) : false;
    const page = pageHtml ? parseHtmlPage(pageOversized ? headOf(pageHtml) : pageHtml, href) : null;
    const meta = page ? extractMeta(page.doc, page.baseUrl) : EMPTY_META;
    const oembedOversized = isOversizedOembed(oembed);
    const data = oembedOversized ? null : readOembed(oembed);
    const tweet = data ? readTweet(data, href) : null;
    const issues = new Set<ReaderIssue>(tweet?.issues);
    if (pageOversized || oembedOversized) issues.add('too_large');
    else if (oembed != null && !data) issues.add('oembed_invalid');

    let content: ReaderContent = tweet?.content ?? { kind: 'none', text: '' };
    if (content.kind === 'none' && meta.description) {
      content = { kind: 'tweet', text: meta.description };
    }

    const author = cleanText(data?.authorName);
    const handle = handleFrom(data?.authorUrl ?? null);
    const fallbackTitle = author ? `${author}${handle ? ` (${handle})` : ''} on X` : null;

    // A post that is only a link (an article of X, another site) has no text of its own: the
    // title of its card names it, and it is the body instead of the shortened link.
    let title = cleanText(content.text, MAX_TITLE) ?? meta.title ?? fallbackTitle;
    let description = meta.description ?? excerpt(content.text);
    if (HAS_LINK.test(content.text) && !hasText(content.text)) {
      const card = cardTitle(page?.doc) ?? (hasText(meta.description) ? meta.description : null);
      const details =
        hasText(meta.description) && meta.description !== card ? meta.description : null;
      if (card) {
        const html = [card, details].flatMap((text) =>
          text ? [`<p>${escapeHtml(text)}</p>`] : [],
        );
        const built = buildContent(sanitizeHtml(html.join(''), href), 'tweet');
        content = built.content;
        built.issues.forEach((issue) => issues.add(issue));
      }
      title =
        cleanText(card, MAX_TITLE) ??
        (meta.title && !HAS_LINK.test(meta.title) ? meta.title : null) ??
        fallbackTitle;
      description = details ?? (hasText(description) ? description : null);
    }

    return {
      source,
      url: href,
      canonicalUrl: oembedCanonical(data?.url, href) ?? sameSiteCanonical(meta.canonicalUrl, href),
      // The title of the page is always "Name (@handle) on X": the text identifies the post, and
      // the origin line already shows the account.
      title,
      description,
      author: author ?? meta.author,
      siteName: meta.siteName ?? 'X',
      imageUrl: postImage(meta.imageUrl),
      publishedAt: tweet?.publishedAt ?? meta.publishedAt,
      content,
      issues: [...issues],
    };
  });
}
