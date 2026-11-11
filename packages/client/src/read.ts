import type { ExtractData } from '@stash/core/extract';
import type { ReadResult } from '@stash/core/sync';
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

/**
 * Reads a link on the device from what the proxy returned. Data from the network that does not
 * have the expected shape degrades to the bare link: a save never fails because of its page.
 */
export function readExtract(data: ExtractData, url: string): ReadResult {
  try {
    return toReadResult(parse(data, url));
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
