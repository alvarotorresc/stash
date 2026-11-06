import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify';
import { normalizeText } from './text';
import { resolveHttpUrl, resolvePublicHttpUrl } from './url';

/** Attribute that keeps the original image URL of an `<img>` without letting it load. */
export const IMAGE_SOURCE_ATTRIBUTE = 'data-stash-src';

const ALLOWED_TAGS = [
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
];

const ALLOWED_ATTR = [
  'alt',
  'colspan',
  'datetime',
  'dir',
  'href',
  'lang',
  'rowspan',
  'src',
  'title',
];

const MAILTO = /^mailto:/i;

interface Mode {
  /** Base URL for relative links and images; none for stored HTML, which is already absolute. */
  baseUrl: string | undefined;
  /** Stored HTML: keeps a valid `data-stash-src` on images instead of reading `src`. */
  stored: boolean;
  /** Stored HTML: page URL that URLs saved against the app's own origin are moved back to. */
  pageUrl: string | undefined;
}

let purifier: Purifier | null = null;
const DEFAULT_MODE: Mode = { baseUrl: undefined, stored: false, pageUrl: undefined };
let mode: Mode = DEFAULT_MODE;

/**
 * Content read before relative links were resolved against the page has them on the app's origin
 * (`https://stash.example/en-US/docs/…`). They go back to the page's origin, keeping path, query
 * and hash. Document-relative links had already lost their directory, so they are only
 * approximately repaired.
 */
function repairAppOrigin(value: string | null): string | null {
  if (!value || !mode.pageUrl) return value;
  try {
    const url = new URL(value.trim());
    if (url.origin !== window.location.origin) return value;
    return new URL(`${url.pathname}${url.search}${url.hash}`, mode.pageUrl).href;
  } catch {
    return value;
  }
}

function getPurifier(): Purifier {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook('uponSanitizeAttribute', (node, data) => {
    // `forceKeepAttr` skips DOMPurify's own checks, so the URL is fully validated here first.
    if (
      mode.stored &&
      node.nodeName === 'IMG' &&
      data.attrName === IMAGE_SOURCE_ATTRIBUTE &&
      resolvePublicHttpUrl(repairAppOrigin(data.attrValue))
    ) {
      data.forceKeepAttr = true;
    }
  });
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A') {
      const href = repairAppOrigin(node.getAttribute('href'));
      const safe =
        href && MAILTO.test(href.trim()) ? href.trim() : resolveHttpUrl(href, mode.baseUrl);
      if (safe) {
        node.setAttribute('href', safe);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
      }
    } else if (node.nodeName === 'IMG') {
      const image = mode.stored
        ? resolvePublicHttpUrl(repairAppOrigin(node.getAttribute(IMAGE_SOURCE_ATTRIBUTE)))
        : resolvePublicHttpUrl(node.getAttribute('src'), mode.baseUrl);
      node.removeAttribute('src');
      if (image) node.setAttribute(IMAGE_SOURCE_ATTRIBUTE, image);
      else node.removeAttribute(IMAGE_SOURCE_ATTRIBUTE);
    }
  });
  purifier = instance;
  return instance;
}

const CONFIG: Config = {
  ALLOWED_TAGS,
  ALLOWED_ATTR,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: true,
  WHOLE_DOCUMENT: false,
};

function run(html: string, next: Mode): string {
  const instance = getPurifier();
  mode = next;
  try {
    return instance.sanitize(html, CONFIG);
  } finally {
    mode = DEFAULT_MODE;
  }
}

/**
 * Sanitizes untrusted HTML before it is rendered in the app.
 *
 * Policy (strict allow-list):
 * - Only basic text, list, table, quote, code and figure tags. No scripts, styles, iframes, forms,
 *   media, SVG or MathML; their text content is kept when it is plain text.
 * - Only `href`, `src`, `alt`, `title`, `lang`, `dir`, `datetime`, `colspan` and `rowspan`. No
 *   `style`, `class`, `id`, event handlers, `srcset`, `background` or `data-*` from the source.
 * - Links: only http(s) (resolved against `baseUrl`) and `mailto:`; anything else loses its
 *   `href`. Every kept link gets `target="_blank"` and `rel="noopener noreferrer"`.
 * - Images never load: `src` is removed and the resolved http(s) URL moves to `data-stash-src`, so
 *   the app can fetch it through the proxy if it wants. No request reaches a third party. URLs on
 *   `localhost` or on a non-public literal IP are dropped.
 *
 * May throw if the engine runs out of stack on absurdly deep markup; the parsers catch it.
 */
export function sanitizeHtml(html: string, baseUrl: string): string {
  return run(html, { baseUrl, stored: false, pageUrl: undefined });
}

/**
 * Sanitizes HTML that was stored (`content.html`) right before it is rendered. The UI must call
 * it every time, just before `{@html}`, whatever the HTML comes from: a fresh extraction, the
 * local cache, sync, or a message from a content script. A fix to the policy then also covers
 * everything saved before it.
 *
 * Same allow-list as `sanitizeHtml`, plus `data-stash-src` kept only on `<img>` and only with an
 * absolute public http(s) URL. Links must already be absolute http(s) or `mailto:`. It is
 * idempotent, and leaves the output of `sanitizeHtml` unchanged.
 *
 * With `pageUrl` (the saved item's http(s) URL), links and images that point to the app's own
 * origin are moved back to the page: earlier versions saved relative links that way.
 */
export function sanitizeStoredHtml(html: string, pageUrl?: string): string {
  return run(html, {
    baseUrl: undefined,
    stored: true,
    pageUrl: resolveHttpUrl(pageUrl) ?? undefined,
  });
}

const BLOCK_TAGS = new Set([
  'BLOCKQUOTE',
  'BR',
  'DD',
  'DIV',
  'DT',
  'FIGCAPTION',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'HR',
  'LI',
  'P',
  'PRE',
  'TR',
]);

/** Plain text of (already sanitized) HTML, one block per line. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    if (BLOCK_TAGS.has(element.tagName)) element.after(doc.createTextNode('\n'));
  }
  return normalizeText(doc.body.textContent ?? '');
}
