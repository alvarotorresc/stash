/**
 * Outbound requests of the extraction proxy, bounded in every dimension: guarded target on every
 * redirect hop, maximum number of hops, one deadline for the whole operation and a byte limit read
 * in streaming. Only `User-Agent` and `Accept` are sent: no cookies, no client headers, no referrer.
 */

import { isAllowedTarget } from './url-guard';

export type Fetcher = typeof fetch;

/** Honest, own User-Agent: identifies the bot and where to learn about it. Never a browser's. */
export const USER_AGENT = 'Mozilla/5.0 (compatible; StashPreview/0.1; +https://stash.alvarotc.com)';

export type UpstreamErrorCode =
  | 'URL_NOT_ALLOWED'
  | 'UPSTREAM_ERROR'
  | 'UPSTREAM_TIMEOUT'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TOO_LARGE';

/** Expected failure of an outbound request. Its message never contains the URL. */
export class UpstreamError extends Error {
  constructor(public readonly code: UpstreamErrorCode) {
    super(code);
    this.name = 'UpstreamError';
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface RequestContext {
  fetch: Fetcher;
  /** Deadline of the whole extraction: covers every hop and the body read. */
  signal: AbortSignal;
  maxRedirects: number;
}

function abortedError(signal: AbortSignal): UpstreamError {
  return new UpstreamError(signal.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_ERROR');
}

/** Rejects as soon as the signal aborts, even if the promise never settles. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new UpstreamError('UPSTREAM_TIMEOUT'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new UpstreamError('UPSTREAM_TIMEOUT'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Anything with headers and a body: a `Response` or a `Request`. */
export interface BodySource {
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

function discard(response: BodySource): void {
  // Releases the connection; a failure to cancel changes nothing for the caller.
  response.body?.cancel().catch(() => undefined);
}

async function requestOnce(url: URL, accept: string, ctx: RequestContext): Promise<Response> {
  try {
    return await raceAbort(
      ctx.fetch(url.href, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: accept },
        redirect: 'manual',
        // Never stored in the Cloudflare cache of the zone: the proxy keeps nothing (D10).
        cache: 'no-store',
        signal: ctx.signal,
      }),
      ctx.signal,
    );
  } catch {
    // Network errors may quote the URL: only the generic code goes up.
    throw abortedError(ctx.signal);
  }
}

function nextHop(response: Response, current: URL): URL {
  const location = response.headers.get('location');
  discard(response);
  if (!location) throw new UpstreamError('UPSTREAM_ERROR');
  let next: URL;
  try {
    next = new URL(location, current);
  } catch {
    throw new UpstreamError('UPSTREAM_ERROR');
  }
  if (!isAllowedTarget(next)) throw new UpstreamError('URL_NOT_ALLOWED');
  return next;
}

type Walk = { response: Response; url: URL } | { response: null; url: URL };

async function walk(
  start: URL,
  accept: string,
  ctx: RequestContext,
  stopAt?: (url: URL) => boolean,
): Promise<Walk> {
  if (!isAllowedTarget(start)) throw new UpstreamError('URL_NOT_ALLOWED');
  let url = start;
  for (let hop = 0; ; hop += 1) {
    if (stopAt?.(url)) return { response: null, url };
    const response = await requestOnce(url, accept, ctx);
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (!response.ok) {
        discard(response);
        throw new UpstreamError('UPSTREAM_ERROR');
      }
      return { response, url };
    }
    if (hop >= ctx.maxRedirects) {
      discard(response);
      throw new UpstreamError('UPSTREAM_ERROR');
    }
    url = nextHop(response, url);
  }
}

/** GET with manual redirects, checking every hop with the SSRF guard. Fails on non-2xx. */
export async function guardedGet(
  start: URL,
  accept: string,
  ctx: RequestContext,
): Promise<{ response: Response; url: URL }> {
  const result = await walk(start, accept, ctx);
  // Without `stopAt` the walk always ends with a response.
  return result as { response: Response; url: URL };
}

/**
 * Follows the redirects of a short link (guarded, like `guardedGet`) until a URL satisfies
 * `isTarget`, without downloading that URL. Fails if the chain ends anywhere else.
 */
export async function resolveRedirects(
  start: URL,
  ctx: RequestContext,
  isTarget: (url: URL) => boolean,
): Promise<URL> {
  const result = await walk(start, 'text/html', ctx, isTarget);
  if (result.response) {
    discard(result.response);
    throw new UpstreamError('UPSTREAM_ERROR');
  }
  return result.url;
}

/** Lower-case media type without parameters (`text/html; charset=utf-8` → `text/html`). */
export function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

export interface BoundedBody {
  bytes: Uint8Array;
  truncated: boolean;
}

/**
 * Reads at most `maxBytes` of a body in streaming. On overflow it either keeps the first
 * `maxBytes` (`truncate`) or fails with `TOO_LARGE` (`reject`); in both cases the rest of the
 * stream is cancelled and never downloaded. `Content-Length` is only used to fail early.
 */
export async function readBounded(
  response: BodySource,
  maxBytes: number,
  overflow: 'truncate' | 'reject',
  signal: AbortSignal,
): Promise<BoundedBody> {
  const declared = Number(response.headers.get('content-length'));
  if (overflow === 'reject' && declared > maxBytes) {
    discard(response);
    throw new UpstreamError('TOO_LARGE');
  }
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      if (total + value.byteLength > maxBytes) {
        if (overflow === 'reject') throw new UpstreamError('TOO_LARGE');
        chunks.push(value.subarray(0, maxBytes - total));
        total = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    reader.cancel().catch(() => undefined);
    throw error instanceof UpstreamError ? error : abortedError(signal);
  }
  if (truncated) reader.cancel().catch(() => undefined);

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, truncated };
}

const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i;

/**
 * Decodes text with the charset of the `Content-Type`, or the one declared by an HTML `<meta>` in
 * the first KiB, or UTF-8. Unknown labels fall back to UTF-8.
 */
export function decodeText(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType ?? '')?.[1];
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 1024));
  const label = fromHeader ?? META_CHARSET.exec(head)?.[1] ?? 'utf-8';
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(label);
  } catch {
    // Unknown or unsupported label: UTF-8 is the web default.
    decoder = new TextDecoder('utf-8');
  }
  return decoder.decode(bytes);
}
