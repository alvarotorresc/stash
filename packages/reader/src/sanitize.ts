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

let purifier: Purifier | null = null;
let currentBaseUrl = '';

function getPurifier(): Purifier {
  if (purifier) return purifier;
  const instance = DOMPurify(window);
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A') {
      const href = node.getAttribute('href');
      const safe =
        href && MAILTO.test(href.trim()) ? href.trim() : resolveHttpUrl(href, currentBaseUrl);
      if (safe) {
        node.setAttribute('href', safe);
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      } else {
        node.removeAttribute('href');
      }
    } else if (node.nodeName === 'IMG') {
      const src = resolvePublicHttpUrl(node.getAttribute('src'), currentBaseUrl);
      node.removeAttribute('src');
      if (src) node.setAttribute(IMAGE_SOURCE_ATTRIBUTE, src);
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
 */
export function sanitizeHtml(html: string, baseUrl: string): string {
  const instance = getPurifier();
  currentBaseUrl = baseUrl;
  try {
    return instance.sanitize(html, CONFIG);
  } finally {
    currentBaseUrl = '';
  }
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
