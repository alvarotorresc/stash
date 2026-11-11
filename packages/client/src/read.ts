import type { ExtractData } from '@stash/core/extract';
import { urlKey, type ReadResult } from '@stash/core/sync';
import {
  minimalResult,
  parsePage,
  parseRedditRss,
  parseTikTok,
  parseXOembed,
  type ReaderResult,
} from '@stash/reader';

/** What the reader makes of the documents the proxy downloaded. */
function parse(data: ExtractData, url: string): ReaderResult {
  switch (data.kind) {
    case 'web':
      return parsePage(data.page.body, url);
    case 'reddit':
      return parseRedditRss(data.feed.body, url);
    case 'x':
      return parseXOembed(data.oembed?.body ?? null, url, data.page?.body);
    case 'instagram':
      return data.page ? parsePage(data.page.body, url) : minimalResult(url);
    case 'tiktok':
      return parseTikTok(data.oembed?.body ?? null, url, data.page?.body);
  }
}

/** The reader's result as the item stores it: preview, content and source. */
export function toReadResult(result: ReaderResult): ReadResult {
  const { content } = result;
  return {
    source: result.source,
    preview: {
      title: result.title,
      description: result.description,
      siteName: result.siteName,
      author: result.author,
      imageUrl: result.imageUrl,
      publishedAt: result.publishedAt,
    },
    content:
      content.html === undefined
        ? { kind: content.kind, text: content.text }
        : { kind: content.kind, html: content.html, text: content.text },
  };
}

/** Path of a video on TikTok; the proxy rebuilds the page address from it. */
const TIKTOK_VIDEO_PATH = /^\/@[\w.-]{0,64}\/video\/\d+\/?$/;

/**
 * The address the proxy read a TikTok short link at: the video's own page. Only when it differs
 * from the link that was saved, so the same video saved again as a full link is recognized.
 */
function canonicalOf(data: ExtractData, url: string): string | undefined {
  if (data.kind !== 'tiktok' || !data.page) return undefined;
  try {
    const page = new URL(data.page.url);
    const onTikTok = page.protocol === 'https:' && /(^|\.)tiktok\.com$/.test(page.hostname);
    if (!onTikTok || !TIKTOK_VIDEO_PATH.test(page.pathname)) return undefined;
    page.search = '';
    page.hash = '';
    return urlKey(page.href) === urlKey(url) ? undefined : page.href;
  } catch {
    return undefined;
  }
}

/**
 * Reads a link on the device from what the proxy returned. Data from the network that does not
 * have the expected shape degrades to the bare link: a save never fails because of its page.
 */
export function readExtract(data: ExtractData, url: string): ReadResult {
  try {
    const canonicalUrl = canonicalOf(data, url);
    return { ...toReadResult(parse(data, url)), ...(canonicalUrl ? { canonicalUrl } : {}) };
  } catch {
    return toReadResult(minimalResult(url));
  }
}

/**
 * Reads the HTML of a page the user has open (the extension reads it from the tab), the same way
 * as a page the proxy downloaded. It never throws: unreadable HTML degrades to the bare link.
 */
export function readHtml(html: string, url: string): ReadResult {
  try {
    return toReadResult(parsePage(html, url));
  } catch {
    return toReadResult(minimalResult(url));
  }
}

/** What is kept when the page cannot be read at all: the link, with an empty preview. */
export function unreadableLink(url: string): ReadResult {
  return toReadResult(minimalResult(url));
}
