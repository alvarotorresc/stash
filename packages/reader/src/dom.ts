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
 * A start tag with its attributes; quoted values may contain `>`. No part of it crosses a `<`, so
 * the match stays linear on hostile input (a tag whose value holds a `<` is just not rewritten).
 */
const START_TAG = /<([a-zA-Z][^\s/<>"']*)(?=[\s/>])((?:"[^"<]*"|'[^'<]*'|[^"'<>])*)>/g;
/** A quoted value (kept as is) or a `style` attribute name. */
const STYLE_ATTRIBUTE = /("[^"]*"|'[^']*')|([\s/])style(?=[\s/=>]|$)/gi;
/** A quoted value (kept as is) or an `href` attribute name. */
const HREF_ATTRIBUTE = /("[^"]*"|'[^']*')|([\s/])href(?=[\s/=>]|$)/gi;
const STYLE_TAG = /<(\/?)style(?=[\s/>])/gi;

function renameAttribute(attributes: string, pattern: RegExp, name: string): string {
  return attributes.replace(pattern, (match, quoted: string | undefined, before: string) =>
    quoted ? match : `${before}${name}`,
  );
}

/**
 * The document parsed here belongs to the app, so the app's CSP applies to it while it is parsed:
 * every inline style and `<base>` in the page logs a violation, even though the copy is inert.
 * Before parsing, `style` attributes become `data-stash-style`, `<style>` becomes `<template>`
 * (inert, removed after parsing) and the `href` of `<base>` becomes `data-stash-href`. It is a
 * plain textual pass: a miss only means a console error, never unsafe output, since everything
 * still goes through the sanitizer.
 */
function neutralizeForCsp(html: string): string {
  return html
    .replace(STYLE_TAG, '<$1template')
    .replace(START_TAG, (match, tag: string, attributes: string) => {
      const renamed = renameAttribute(attributes, STYLE_ATTRIBUTE, 'data-stash-style');
      const safe =
        tag.toLowerCase() === 'base'
          ? renameAttribute(renamed, HREF_ATTRIBUTE, 'data-stash-href')
          : renamed;
      return safe === attributes ? match : `<${tag}${safe}>`;
    });
}

/**
 * Parses HTML into an inert document (no scripts run, no images load).
 *
 * - Inline styles and `<base>` are neutralized first (see `neutralizeForCsp`); what is left of them
 *   after parsing is removed.
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
  const source = neutralizeForCsp(html);
  let doc = parser.parseFromString(source, 'text/html');
  if (!hasBody(doc)) {
    const inner = source.replace(/<!doctype[^>]*>/i, '');
    doc = parser.parseFromString(`<html><head></head><body>${inner}</body></html>`, 'text/html');
  }
  const bases = Array.from(doc.querySelectorAll('base'));
  const pageBase = bases[0]?.getAttribute('data-stash-href') ?? bases[0]?.getAttribute('href');
  const baseUrl = resolveHttpUrl(pageBase, url) ?? url;
  for (const element of doc.querySelectorAll('base, style, template')) element.remove();
  for (const element of doc.querySelectorAll('[style]')) element.removeAttribute('style');
  Object.defineProperty(doc, 'baseURI', { value: baseUrl, configurable: true });
  return { doc, baseUrl };
}
