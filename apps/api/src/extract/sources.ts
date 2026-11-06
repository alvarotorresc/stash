/**
 * Source adapters: what to download for each kind of link. They only download;
 * parsing happens on the device. No third-party service ever sees the URL.
 */

import type { ExtractData, FetchedDocument, XExtract } from '@stash/core/extract';
import {
  decodeText,
  guardedGet,
  mediaType,
  readBounded,
  resolveRedirects,
  UpstreamError,
  type RequestContext,
} from './safe-fetch';

export interface DocumentLimits {
  /** Pages and feeds: cut at this size (the `<head>` is at the start). */
  maxDocumentBytes: number;
  /** JSON (oEmbed): rejected above this size, since cut JSON is useless. */
  maxJsonBytes: number;
}

export interface SourceContext extends RequestContext {
  limits: DocumentLimits;
}

interface DocumentSpec {
  accept: string;
  types: ReadonlySet<string>;
  maxBytes: (limits: DocumentLimits) => number;
  overflow: 'truncate' | 'reject';
}

const HTML: DocumentSpec = {
  accept: 'text/html,application/xhtml+xml;q=0.9',
  types: new Set(['text/html', 'application/xhtml+xml']),
  maxBytes: (limits) => limits.maxDocumentBytes,
  overflow: 'truncate',
};

const FEED: DocumentSpec = {
  accept: 'application/atom+xml,application/rss+xml;q=0.9,application/xml;q=0.8',
  types: new Set(['application/atom+xml', 'application/rss+xml', 'application/xml', 'text/xml']),
  maxBytes: (limits) => limits.maxDocumentBytes,
  overflow: 'truncate',
};

const JSON_DOC: DocumentSpec = {
  accept: 'application/json',
  types: new Set(['application/json']),
  maxBytes: (limits) => limits.maxJsonBytes,
  overflow: 'reject',
};

async function fetchDocument(
  url: URL,
  spec: DocumentSpec,
  ctx: SourceContext,
): Promise<FetchedDocument> {
  const { response, url: finalUrl } = await guardedGet(url, spec.accept, ctx);
  const header = response.headers.get('content-type');
  const type = mediaType(header);
  if (!spec.types.has(type)) {
    response.body?.cancel().catch(() => undefined);
    throw new UpstreamError('UNSUPPORTED_MEDIA_TYPE');
  }
  const { bytes, truncated } = await readBounded(
    response,
    spec.maxBytes(ctx.limits),
    spec.overflow,
    ctx.signal,
  );
  return { url: finalUrl.href, contentType: type, body: decodeText(bytes, header), truncated };
}

/** Exact domain or any subdomain of it; never a substring match. */
export function hostIs(url: URL, domain: string): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith(`.${domain}`);
}

// --- Reddit: the Atom feed of the post, with its full text. ---

const REDDIT_POST = /^\/((?:r|u|user)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i;
const REDDIT_SHARE = /^\/r\/[^/]+\/s\/[^/]+/i;

export function isRedditUrl(url: URL): boolean {
  return hostIs(url, 'reddit.com') || hostIs(url, 'redd.it');
}

/** Feed URL of a Reddit post, always on `www.reddit.com` and without the query. */
export function redditFeedUrl(url: URL): URL | null {
  if (!hostIs(url, 'reddit.com')) return null;
  const match = REDDIT_POST.exec(url.pathname);
  if (!match) return null;
  const [, prefix = '', id = ''] = match;
  return new URL(`https://www.reddit.com/${prefix}comments/${id.toLowerCase()}/.rss`);
}

function isRedditShortLink(url: URL): boolean {
  return hostIs(url, 'redd.it') || REDDIT_SHARE.test(url.pathname);
}

async function extractReddit(url: URL, ctx: SourceContext): Promise<ExtractData> {
  let feedUrl = redditFeedUrl(url);
  if (!feedUrl && isRedditShortLink(url)) {
    const target = await resolveRedirects(url, ctx, (hop) => redditFeedUrl(hop) !== null);
    feedUrl = redditFeedUrl(target);
  }
  // Not a post (a subreddit, a profile...): treat it as any other page.
  if (!feedUrl) return extractWeb(url, ctx);
  return { kind: 'reddit', feed: await fetchDocument(feedUrl, FEED, ctx) };
}

// --- X: official oEmbed + the meta tags of the post page. ---

const X_STATUS = /^\/([a-z0-9_]{1,15})\/status(?:es)?\/(\d{1,25})(?:\/|$)/i;

export function xStatus(url: URL): { user: string; id: string } | null {
  if (!hostIs(url, 'x.com') && !hostIs(url, 'twitter.com')) return null;
  const match = X_STATUS.exec(url.pathname);
  if (!match) return null;
  const [, user = '', id = ''] = match;
  return { user, id };
}

async function extractX(status: { user: string; id: string }, ctx: SourceContext) {
  const canonical = `https://twitter.com/${status.user}/status/${status.id}`;
  const oembedUrl = new URL('https://publish.twitter.com/oembed');
  oembedUrl.searchParams.set('url', canonical);
  oembedUrl.searchParams.set('omit_script', '1');
  oembedUrl.searchParams.set('dnt', 'true');
  const pageUrl = new URL(`https://x.com/${status.user}/status/${status.id}`);

  const [oembed, page] = await Promise.allSettled([
    fetchDocument(oembedUrl, JSON_DOC, ctx),
    fetchDocument(pageUrl, HTML, ctx),
  ]);
  if (oembed.status === 'rejected' && page.status === 'rejected') throw oembed.reason;
  const result: XExtract = {
    kind: 'x',
    oembed: oembed.status === 'fulfilled' ? oembed.value : null,
    page: page.status === 'fulfilled' ? page.value : null,
  };
  return result;
}

// --- Instagram: preview from meta tags only; never the embed page. ---

export function isInstagramUrl(url: URL): boolean {
  return hostIs(url, 'instagram.com') || hostIs(url, 'instagr.am');
}

async function extractInstagram(url: URL, ctx: SourceContext): Promise<ExtractData> {
  try {
    const page = await fetchDocument(url, HTML, ctx);
    // A redirect to the login page carries no preview of the post.
    const landedOnLogin = new URL(page.url).pathname.startsWith('/accounts/login');
    return { kind: 'instagram', page: landedOnLogin ? null : page };
  } catch (error) {
    // Instagram usually blocks requests from datacenters: the client keeps the plain link.
    if (error instanceof UpstreamError && error.code !== 'URL_NOT_ALLOWED') {
      return { kind: 'instagram', page: null };
    }
    throw error;
  }
}

// --- Any other page. ---

async function extractWeb(url: URL, ctx: SourceContext): Promise<ExtractData> {
  return { kind: 'web', page: await fetchDocument(url, HTML, ctx) };
}

/** Downloads what the device needs to build the preview and reader view of `url`. */
export async function extract(url: URL, ctx: SourceContext): Promise<ExtractData> {
  if (isRedditUrl(url)) return extractReddit(url, ctx);
  const status = xStatus(url);
  if (status) return extractX(status, ctx);
  if (isInstagramUrl(url)) return extractInstagram(url, ctx);
  return extractWeb(url, ctx);
}
