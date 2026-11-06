# @stash/reader

Turns what the extraction proxy returns (or the page open in the extension) into one model:
preview metadata plus, when possible, sanitized content to read inside the app. It runs on the
device, never on the server.

## Usage

```ts
import {
  parseDocument,
  parsePage,
  parseRedditRss,
  parseXOembed,
  sanitizeStoredHtml,
} from '@stash/reader';

parsePage(html, url); // web pages and Instagram (preview only)
parseRedditRss(xml, url); // the post's .rss feed
parseXOembed(oembedJson, url, pageHtml); // official oEmbed + og:image from the page
parseDocument(document, location.href); // the tab open in the extension
sanitizeStoredHtml(result.content.html); // always, right before rendering (see below)
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

### Limits

Hostile or just huge pages must not freeze the app, so the parsers stop early (`src/limits.ts`):

| Limit                 | Value                       | When it is crossed                                                   |
| --------------------- | --------------------------- | -------------------------------------------------------------------- |
| Input size            | 2 MiB (UTF-8), as the proxy | Pages: metadata from their start only. Feeds and oEmbed: not parsed. |
| Elements in the page  | 20 000                      | No reader mode: preview from the metadata.                           |
| Nesting depth         | 100 levels                  | No reader mode: preview from the metadata.                           |
| `content.html` length | 1 MiB (UTF-16 units)        | The HTML is dropped (never cut); the text is kept.                   |
| `content.text` length | 512 KiB (UTF-16 units)      | The text is cut.                                                     |

Each case records the `too_large` issue. Elements and depth are measured with an iterative walk
before Readability runs, which also gets `maxElemsToParse` as a second barrier. The same structure
check applies to the HTML inside Reddit feeds and oEmbed responses.

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
- Image URLs (`data-stash-src` and `imageUrl`) on `localhost` or on a literal IP that is not
  public (loopback, private, link-local, unique local, multicast…) are dropped. Host names that
  only resolve to such addresses are not detected here: the proxy must block them too.

Parsing is always inert (`DOMParser`), so nothing runs or loads before sanitizing.

### Rendering stored HTML

`content.html` is sanitized when it is extracted, but that is not enough: what is stored outlives
the policy that produced it, and HTML can come back from places the app does not control. So the
UI must pass it through `sanitizeStoredHtml` **every time, right before `{@html}`**, whether it
comes from a fresh extraction, the local cache, sync, or a message from a content script.

`sanitizeStoredHtml` uses the same allow-list, keeps `data-stash-src` only on `<img>` and only
with an absolute public http(s) URL, and requires links to be absolute already. It is idempotent
(`sanitizeStoredHtml(sanitizeStoredHtml(x)) === sanitizeStoredHtml(x)`) and leaves the output of
the parsers unchanged, so applying it always costs nothing but a few milliseconds.

### Text fields and canonical URL

- Text fields (`title`, `description`, `author`, `siteName`, `content.text`) are plain text. They
  lose control characters and bidi controls (U+061C, U+200E/F, U+202A–U+202E, U+2066–U+2069),
  which could make a title read as something else, and are capped without splitting a character.
  They may still contain `<`, `>` or quotes from the page.
- `canonicalUrl` is only taken from the page (`link rel=canonical`, `og:url`, the feed link or the
  oEmbed URL) when it is on the same site as `url`: the same host, or one host a subdomain of the
  other. Otherwise it is `url`. Without a public suffix list this is a strict approximation:
  sibling subdomains fall back to `url`. For X, `x.com` and `twitter.com` count as one site.

## Requirements for the UI

The PWA and the extension must follow these rules when they show what this package returns:

1. **Text fields** (`title`, `author`, `description`, `siteName`, `publishedAt`, `content.text`):
   always as text (`{title}` in Svelte), never with `{@html}`, `innerHTML` or attributes built by
   hand. They can contain markup characters straight from the page.
2. **`content.html`**: only as `{@html sanitizeStoredHtml(item.content.html)}`, right before
   rendering, also for HTML from the cache or sync. Render it inside a container of its own, with
   no `id` the UI uses for something else.
3. **Images** (`imageUrl` and `data-stash-src`): never put those URLs in `src`, in a CSS
   `background` or in a direct `fetch`. Download them through the proxy, which returns the bytes,
   and show only a `blob:` URL made from them (or the stored, encrypted thumbnail). To go through
   the images of the content, select `img[data-stash-src]` inside the container and check the URL
   is http(s) again.
4. **Links**: "open original" uses `url`, never `canonicalUrl`, and so does the domain shown. The
   links in the content already have `target="_blank" rel="noopener noreferrer"`: keep them. In the
   extension, open them with `chrome.tabs.create` or leave the `target`.
5. **Content Security Policy of the PWA**, as a response header (not a `<meta>`):

   ```text
   default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self';
   img-src 'self' blob: data:; font-src 'self'; connect-src 'self' https://<api and proxy>;
   worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'self';
   frame-src 'none'; frame-ancestors 'none'; object-src 'none'
   ```

   `img-src` without external hosts is the privacy safety net if sanitizing ever regresses.
   `'wasm-unsafe-eval'` is only for the WebAssembly crypto library. No `'unsafe-inline'` in
   `script-src`; if the framework needs inline styles, allow it only in `style-src` (the allow-list
   already removes `style` from the content).

6. **Content Security Policy of the extension** (`content_security_policy.extension_pages` in the
   MV3 manifest): `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; img-src 'self' blob:
data:; base-uri 'none'; frame-ancestors 'none'`, with `connect-src` limited to the API.
7. **Trusted Types** (optional, where supported): `require-trusted-types-for 'script'` with a
   single policy that calls `sanitizeStoredHtml`.
8. **Extension messaging**: anything that comes from a content script is checked for shape and its
   HTML is sanitized again. Better still, the content script sends only `outerHTML` as text and
   the parsing happens in the extension page.
9. **Explicit action only**: call `parseDocument` when the user asks to save the tab (button or
   context menu), never automatically. It reads whatever the page shows, signed-in content
   included.

## Bundle size

73.5 KiB minified, 26.1 KiB gzip (Readability ~34 KiB, DOMPurify ~31 KiB, own code ~9 KiB,
minified). Measured with esbuild 0.28.2 (`--bundle --minify --format=esm --platform=browser`) on
`src/index.ts`, 2026-11-05.
