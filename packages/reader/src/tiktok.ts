import { parseHtmlPage } from './dom';
import { ReaderInputError } from './errors';
import { exceedsInputLimit, headOf } from './limits';
import { cleanText } from './meta';
import { safely } from './result';
import type { ReaderIssue, ReaderResult } from './types';
import { resolvePublicHttpUrl } from './url';

/** Longest title taken from the caption of a video. */
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 1000;

type Json = Record<string, unknown>;

interface Video {
  caption: string | null;
  author: string | null;
  imageUrl: string | null;
  publishedAt: string | null;
}

const NO_VIDEO: Video = { caption: null, author: null, imageUrl: null, publishedAt: null };

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** An untrusted JSON value, given as an object or as its JSON text. */
function readJson(value: unknown): Json | null {
  if (typeof value !== 'string') return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

/** ISO date-time of a Unix time in seconds, given as a number or a numeric string. */
function fromUnixSeconds(value: unknown): string | null {
  const seconds = typeof value === 'string' ? Number(value) : value;
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const STATE_SELECTOR = 'script#__UNIVERSAL_DATA_FOR_REHYDRATION__';

/**
 * What the video page of tiktok.com embeds for its own hydration (`webapp.video-detail`). It is not
 * a documented interface, so every step is checked and anything unexpected is "no video": the link
 * is kept and nothing else. Only the caption, author, cover and date are read; the media addresses
 * in the same object are never touched.
 */
function readVideoState(pageHtml: string, href: string): Video {
  const { doc } = parseHtmlPage(pageHtml, href);
  const state = readJson(doc.querySelector(STATE_SELECTOR)?.textContent);
  const detail = record(record(state?.__DEFAULT_SCOPE__)?.['webapp.video-detail']);
  // A video that does not exist, or that is not public, comes with an error code.
  if (!detail || detail.statusCode !== 0) return NO_VIDEO;
  const item = record(record(detail.itemInfo)?.itemStruct);
  const author = record(item?.author);
  return {
    caption: text(item?.desc) ?? text(record(detail.shareMeta)?.desc),
    author: text(author?.nickname) ?? text(author?.uniqueId),
    imageUrl: text(record(item?.video)?.cover),
    publishedAt: fromUnixSeconds(item?.createTime),
  };
}

/**
 * Parses a TikTok video from the official oEmbed response (`tiktok.com/oembed`) plus, optionally,
 * the HTML of the video page.
 *
 * - oEmbed documents `title` (the caption), `author_name` and `thumbnail_url`, and they are used
 *   when present. In practice the endpoint now answers only an iframe, so the page is the source
 *   of the caption, the author, the cover and the date. The iframe `html` is never read.
 * - TikTok's own title and meta tags of the page are generic ("TikTok - Make Your Day"): never used.
 * - Preview only (`content.kind = 'none'`), like Instagram: the text of the video is its caption.
 * - `imageUrl` is the cover. TikTok signs it and it expires within days, so it has to be
 *   downloaded through the proxy when the link is saved, not kept as an address.
 * - Over the size limit (2 MiB) the oEmbed response is ignored and the page is read from its
 *   start; the result records `too_large`.
 *
 * Throws `ReaderInputError` only for an invalid URL or a non-string `pageHtml`.
 */
export function parseTikTok(oembed: unknown, url: string, pageHtml?: string): ReaderResult {
  if (pageHtml !== undefined && typeof pageHtml !== 'string') {
    throw new ReaderInputError('pageHtml must be a string');
  }
  return safely(url, (href, source) => {
    const issues: ReaderIssue[] = [];
    const oembedOversized = typeof oembed === 'string' && exceedsInputLimit(oembed);
    const pageOversized = pageHtml ? exceedsInputLimit(pageHtml) : false;
    const data = oembedOversized ? null : readJson(oembed);
    if (oembedOversized || pageOversized) issues.push('too_large');
    else if (oembed != null && !data) issues.push('oembed_invalid');

    const video =
      pageHtml === undefined
        ? NO_VIDEO
        : readVideoState(pageOversized ? headOf(pageHtml) : pageHtml, href);

    const caption = text(data?.title) ?? video.caption;
    const author = cleanText(text(data?.author_name) ?? video.author);
    return {
      source,
      url: href,
      canonicalUrl: href,
      title: cleanText(caption, MAX_TITLE) ?? (author ? `${author} on TikTok` : null),
      description: cleanText(caption, MAX_DESCRIPTION),
      author,
      siteName: 'TikTok',
      imageUrl: resolvePublicHttpUrl(text(data?.thumbnail_url) ?? video.imageUrl, href),
      publishedAt: video.publishedAt,
      content: { kind: 'none', text: '' },
      issues,
    };
  });
}
