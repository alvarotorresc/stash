import { htmlToText } from './sanitize';
import { truncate } from './text';
import type { ContentKind, ReaderContent, ReaderIssue } from './types';

/** Largest input accepted, in UTF-8 bytes. The extraction proxy stops reading at the same size. */
export const MAX_INPUT_BYTES = 2 * 1024 * 1024;
/** Most elements a page may have to go through reader mode. */
export const MAX_ELEMENTS = 20_000;
/** Deepest nesting a page may have to go through reader mode (the root counts as 0). */
export const MAX_DEPTH = 100;
/** Longest `content.html` kept, in UTF-16 units. Longer HTML is dropped; the text stays. */
export const MAX_CONTENT_HTML = 1024 * 1024;
/** Longest `content.text` kept, in UTF-16 units. Longer text is cut. */
export const MAX_CONTENT_TEXT = 512 * 1024;

/** True when `value` takes more than `MAX_INPUT_BYTES` in UTF-8. */
export function exceedsInputLimit(value: string): boolean {
  // A UTF-16 unit takes 1 to 3 UTF-8 bytes, so most inputs are decided without encoding them.
  if (value.length > MAX_INPUT_BYTES) return true;
  if (value.length * 3 <= MAX_INPUT_BYTES) return false;
  return new TextEncoder().encode(value).length > MAX_INPUT_BYTES;
}

/** Start of an oversized input that fits the limit, to read its metadata only. */
export function headOf(value: string): string {
  let cut = Math.floor(MAX_INPUT_BYTES / 3);
  const last = value.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return value.slice(0, cut);
}

/**
 * True when the tree under `root` has more than `MAX_ELEMENTS` elements or is deeper than
 * `MAX_DEPTH`. Reader mode slows down with both (many parallel chains of deep nesting freeze the
 * page for seconds), so such pages are not read. The walk is iterative, without recursion or a
 * stack, and stops as soon as a limit is crossed.
 */
export function exceedsStructureLimits(root: Element): boolean {
  let node: Element | null = root;
  let depth = 0;
  let count = 0;
  while (node) {
    count += 1;
    if (count > MAX_ELEMENTS || depth > MAX_DEPTH) return true;
    const firstChild: Element | null = node.firstElementChild;
    if (firstChild) {
      node = firstChild;
      depth += 1;
      continue;
    }
    while (node && node !== root && !node.nextElementSibling) {
      node = node.parentElement;
      depth -= 1;
    }
    if (!node || node === root) return false;
    node = node.nextElementSibling;
  }
  return false;
}

/**
 * Content of already sanitized HTML, with its plain text, within the length limits. HTML over
 * `MAX_CONTENT_HTML` is dropped rather than cut (cut markup is no longer sanitized markup) and only
 * the text is kept; text over `MAX_CONTENT_TEXT` is cut. Either records `too_large`.
 */
export function buildContent(
  html: string,
  kind: Exclude<ContentKind, 'none'>,
): { content: ReaderContent; issues: ReaderIssue[] } {
  const fullText = html ? htmlToText(html) : '';
  if (!fullText) return { content: { kind: 'none', text: '' }, issues: [] };
  const htmlTooLong = html.length > MAX_CONTENT_HTML;
  const textTooLong = fullText.length > MAX_CONTENT_TEXT;
  const text = textTooLong ? truncate(fullText, MAX_CONTENT_TEXT) : fullText;
  return {
    content: htmlTooLong ? { kind, text } : { kind, html, text },
    issues: htmlTooLong || textTooLong ? ['too_large'] : [],
  };
}
