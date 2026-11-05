# @stash/reader

Turns what the extraction proxy returns (or the page open in the extension) into one model:
preview metadata plus, when possible, sanitized content to read inside the app. It runs on the
device, never on the server.

## Usage

```ts
import { parsePage, parseRedditRss, parseXOembed, parseDocument } from '@stash/reader';

parsePage(html, url); // web pages and Instagram (preview only)
parseRedditRss(xml, url); // the post's .rss feed
parseXOembed(oembedJson, url, pageHtml); // official oEmbed + og:image from the page
parseDocument(document, location.href); // the tab open in the extension
```

Every function returns a `ReaderResult` (see `src/types.ts`). They need a DOM (`DOMParser` and
`window`): the PWA, extension pages and content scripts. They do not work in a service worker.

## Sources

| Source      | Input                                          | Content                                |
| ----------- | ---------------------------------------------- | -------------------------------------- |
| `web`       | Page HTML                                      | Metadata + reader mode (Readability)   |
| `reddit`    | Atom feed of the post (`…/comments/<id>/.rss`) | Post text only; comments are discarded |
| `x`         | oEmbed JSON (`omit_script=1`) + page HTML      | Post text, author and date; `og:image` |
| `instagram` | Page HTML                                      | Preview only (`content.kind = 'none'`) |

`detectSource` matches hosts and their subdomains. `isShortLink` flags links whose target needs a
network redirect to be known, which the proxy must resolve first: `t.co/<code>` (any site),
`redd.it/<id>` and `reddit.com/r/<sub>/s/<code>`. Generic shorteners are not detected.

## Degradation

Bad or unexpected data never throws: the result keeps at least the URL and whatever could be read,
and `issues` says what went wrong. Only invalid input throws `ReaderInputError`: a URL that is not
absolute http(s), or a payload of the wrong type.

## Sanitizing policy

All HTML goes through DOMPurify with a strict allow-list before it is returned:

- Tags: basic text, headings, lists, quotes, code, tables, figures, links and images. No scripts,
  styles, iframes, forms, media, SVG or MathML.
- Attributes: `href`, `src`, `alt`, `title`, `lang`, `dir`, `datetime`, `colspan`, `rowspan`. No
  `style`, `class`, `id`, event handlers, `srcset`, `background` or `data-*` from the source.
- Links: only http(s) (resolved against the page, never against the app's origin) and `mailto:`;
  any other `href` is removed. Kept links get `target="_blank"` and `rel="noopener noreferrer"`.
- Images never load: `src` is removed and the http(s) URL moves to `data-stash-src`. The app may
  fetch it through the proxy; no request reaches a third party. `imageUrl` follows the same rule:
  download it through the proxy, never from the client.

Parsing is always inert (`DOMParser`), so nothing runs or loads before sanitizing.

## Bundle size

73.5 KiB minified, 26.1 KiB gzip (Readability ~34 KiB, DOMPurify ~31 KiB, own code ~9 KiB,
minified). Measured with esbuild 0.28.2 (`--bundle --minify --format=esm --platform=browser`) on
`src/index.ts`, 2026-11-05.
