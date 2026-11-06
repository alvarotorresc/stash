import { resolveHttpUrl } from './url';

/** The part of `DOMParser` this package needs (the browser's, jsdom's or linkedom's). */
export interface HtmlParser {
  parseFromString(source: string, type: 'text/html'): Document;
}

export interface ParsedPage {
  doc: Document;
  /** Base URL for relative links: the page's own `<base>` if it is http(s), else the page URL. */
  baseUrl: string;
}

function hasBody(doc: Document): boolean {
  const root = doc.documentElement as Element | null;
  return root?.localName === 'html' && doc.body?.parentNode === root;
}

/**
 * Parses HTML into an inert document (no scripts run, no images load).
 *
 * - If the parser does not build `<html>` with a `<body>` inside (linkedom does not when the HTML
 *   omits them, which is valid HTML5: its root becomes the first element and `body` is detached),
 *   the HTML is wrapped in `<html><head></head><body>…</body></html>` and parsed again; otherwise
 *   Readability fails. Browsers and jsdom always build both.
 * - No `<base>` is ever added: the app's CSP (`base-uri 'none'`) blocks it, and relative links
 *   would then resolve against the app's origin. Instead the document's `baseURI` is set to the
 *   page's base URL, which is what Readability resolves links and images against. Links to an
 *   anchor of the same page (`#id`) come out as absolute URLs of the page.
 */
export function parseHtmlPage(
  html: string,
  url: string,
  parser: HtmlParser = new DOMParser(),
): ParsedPage {
  let doc = parser.parseFromString(html, 'text/html');
  if (!hasBody(doc)) {
    const inner = html.replace(/<!doctype[^>]*>/i, '');
    doc = parser.parseFromString(`<html><head></head><body>${inner}</body></html>`, 'text/html');
  }
  const bases = Array.from(doc.querySelectorAll('base'));
  const baseUrl = resolveHttpUrl(bases[0]?.getAttribute('href'), url) ?? url;
  for (const base of bases) base.remove();
  Object.defineProperty(doc, 'baseURI', { value: baseUrl, configurable: true });
  return { doc, baseUrl };
}
