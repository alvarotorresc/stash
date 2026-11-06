/** Where a saved link comes from. Used for filters and to pick a parser. */
export type Source = 'web' | 'reddit' | 'x' | 'instagram';

/**
 * What kind of readable content was extracted.
 * - `article`: reader mode of a web page.
 * - `post`: the text of a Reddit post (never its comments).
 * - `tweet`: the text of a post on X.
 * - `none`: preview only (title, description, image, link).
 */
export type ContentKind = 'article' | 'post' | 'tweet' | 'none';

export interface ReaderContent {
  kind: ContentKind;
  /** Sanitized HTML, safe to render. Absent when there is nothing to render. */
  html?: string;
  /** Plain text of the content (one block per line), for search. Empty when `kind` is `none`. */
  text: string;
}

/**
 * Non-fatal problems found while parsing. Parsers never throw on bad data from the network:
 * they degrade and record why here.
 */
export type ReaderIssue =
  'unexpected_error' | 'no_readable_content' | 'rss_invalid' | 'rss_no_entry' | 'oembed_invalid';

export interface ReaderResult {
  source: Source;
  /** The URL the user saved. Always present. */
  url: string;
  /**
   * Canonical URL announced by the page (http/https only) when it is on the same site as `url`;
   * otherwise `url`. To open the original or show its domain, use `url`.
   */
  canonicalUrl: string;
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  /**
   * Preview image (http/https only, never `localhost` or a non-public literal IP). Never load it directly from the client: download it through
   * the proxy so no third party learns what is being read.
   */
  imageUrl: string | null;
  /** ISO 8601 date (`YYYY-MM-DD`) or date-time, when known. */
  publishedAt: string | null;
  content: ReaderContent;
  issues: ReaderIssue[];
}
