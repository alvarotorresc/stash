/**
 * Contract of the extraction proxy (`POST /api/extract` and `POST /api/extract/image`).
 *
 * The server only downloads (it never parses the content): the device receives the raw documents
 * and builds the preview and the reader view itself. Types only, plus a few shared constants, so
 * any client can import it without pulling in server code.
 */

/** Body of both `POST /api/extract` and `POST /api/extract/image`. */
export interface ExtractRequest {
  /** Absolute `http:` or `https:` URL. Always in the body, never in the query string. */
  url: string;
}

/** Maximum length of `ExtractRequest.url`, in characters. */
export const EXTRACT_MAX_URL_LENGTH = 2048;

/** A document downloaded by the proxy, already decoded to text. */
export interface FetchedDocument {
  /** URL the content was finally served from, after redirects. */
  url: string;
  /** `Content-Type` sent by the origin, normalised to lower case. */
  contentType: string;
  /** Decoded text of the response (HTML, Atom/RSS XML or JSON, depending on the field). */
  body: string;
  /** True when the body was cut at the size limit; the start (with the `<head>`) is still there. */
  truncated: boolean;
}

/** Any web page: the HTML of the page, for its meta tags and the reader view. */
export interface WebExtract {
  kind: 'web';
  page: FetchedDocument;
}

/** Reddit post: the Atom feed of the post (`<post>/.rss`). The first entry is the post; the rest are comments and must be discarded. */
export interface RedditExtract {
  kind: 'reddit';
  feed: FetchedDocument;
}

/**
 * Post on X: the official oEmbed JSON (text, author, date) and the HTML of the post page (meta
 * tags with the image). Either can be null if that download failed; never both.
 */
export interface XExtract {
  kind: 'x';
  oembed: FetchedDocument | null;
  page: FetchedDocument | null;
}

/**
 * Instagram: preview only, from the meta tags of the post page. `page` is null when Instagram
 * does not serve it (it usually answers 429 or redirects to the login); the client then keeps the
 * plain link.
 */
export interface InstagramExtract {
  kind: 'instagram';
  page: FetchedDocument | null;
}

/** `data` of a successful `POST /api/extract`, discriminated by `kind`. */
export type ExtractData = WebExtract | RedditExtract | XExtract | InstagramExtract;

export type ExtractKind = ExtractData['kind'];

/**
 * Image types accepted by `POST /api/extract/image`. SVG is never accepted.
 *
 * On success that endpoint answers the raw bytes of the image (not a JSON envelope), with
 * `Content-Type` set to one of these types. Errors use the JSON error envelope.
 */
export const EXTRACT_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
] as const;

export type ExtractImageType = (typeof EXTRACT_IMAGE_TYPES)[number];

/** Error codes of both endpoints, inside `{ error: { code, message } }`. */
export const EXTRACT_ERROR_CODES = [
  /** 400: body is not JSON, has no `url` string or is too long. */
  'VALIDATION_ERROR',
  /** 400: URL rejected (not http/https, forbidden port, private or local address). */
  'URL_NOT_ALLOWED',
  /** 401: no valid session. */
  'UNAUTHORIZED',
  /** 405: method other than POST. */
  'METHOD_NOT_ALLOWED',
  /** 413: image larger than the limit. */
  'TOO_LARGE',
  /** 415: request body is not JSON, or the origin answered a content type that is not allowed. */
  'UNSUPPORTED_MEDIA_TYPE',
  /** 429: too many extractions. */
  'RATE_LIMITED',
  /** 502: the origin failed (network error, non-2xx status, too many redirects). */
  'UPSTREAM_ERROR',
  /** 504: the origin took too long. */
  'UPSTREAM_TIMEOUT',
] as const;

export type ExtractErrorCode = (typeof EXTRACT_ERROR_CODES)[number];
