# @stash/api

Cloudflare Worker that serves the PWA and the `/api/*` routes on `stash.alvarotc.com`.

## Extraction proxy

`POST /api/extract` and `POST /api/extract/image` download a page or a preview image for the
client, which cannot do it itself because of CORS. The proxy downloads and forgets: nothing is
stored and the requested URL is never logged nor echoed. The contract lives in
`packages/core/src/extract.ts`.

### Size limits and compressed bodies

Every body is read through a bounded reader (2 MiB for pages, 256 KiB for JSON, 5 MiB for images).
The limit applies to the decompressed body: Workers decodes `Content-Encoding: gzip` before the
Worker reads the stream, so a small compressed body that expands a lot is cut at the limit.

This was checked locally with `wrangler dev` and a server answering 10 KiB of gzip that expands to
10 MiB: the Worker read 10 MiB from the stream and the bounded reader refused it with `TOO_LARGE`.
Local `workerd` suggests, but does not prove, how the edge behaves.

### Images and pixel bombs

`POST /api/extract/image` accepts only JPEG, PNG, WebP, GIF and AVIF. Both the `Content-Type` of the
origin and the signature of the first bytes must match one of those types, and the body is capped
in bytes.

The server does not decode the image, so it does not limit its dimensions. A small, valid file can
declare a huge canvas (a pixel bomb). That protection belongs to the client: when it builds the
thumbnail, it must read or bound the dimensions before decoding (for example with
`createImageBitmap` and `resizeWidth`/`resizeHeight`) and discard images above a megapixel limit.

### User-Agent

Outbound requests identify themselves as
`Mozilla/5.0 (compatible; StashPreview/0.1; +https://stash.alvarotc.com/bot)` and send only
`User-Agent` and `Accept`.

**Pending before release:** publish the page at `https://stash.alvarotc.com/bot`. It must explain
what StashPreview does (it only downloads a page when a user saves a link, stores nothing and
follows no links) and how to contact the maintainer.

## Pending before sessions are enabled

Today every private route answers 401, because the session resolver fails closed, and the rate
limiter is `allowAll`. Before the real session resolver replaces that stub, the extraction routes
need real rate limiting, wired in `src/index.ts` in place of `allowAll`:

- **Per-account limit** on `/api/extract` and `/api/extract/image`, keyed by account id.
- **Global cap** on extractions across all accounts, as a fixed key in the same limiter, so many
  accounts at once cannot exhaust the daily Workers request quota and take down sync with it.
  Registration is free, so the per-account limit only holds if sign-up is itself limited by IP.
- **Implementation:** the Workers Rate Limiting binding (`[[ratelimits]]` in `wrangler.toml`) if it
  is available on the Free plan, which is not verified yet. Otherwise, a counter per account and
  time window in D1 (exact, at the cost of one write per extraction).
- **Guard test:** a test that fails if the production limiter is still `allowAll` once the session
  resolver is no longer the fail-closed stub, so sessions cannot ship without it.
