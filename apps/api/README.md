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

## Accounts and sessions

The account routes (`/api/auth/*` and `/api/account*`) live in `src/accounts/`. Every private
route, extraction included, resolves its session from the `Authorization: Bearer` token through
`createSessionResolver` in `src/auth/session.ts`: unknown, closed or expired tokens answer 401.

## Rate limiting

Counters live in D1 (`rate_limits`), in fixed windows keyed by an HMAC of the bucket and its
subject, so neither emails nor IP addresses are stored. Limits are in `src/accounts/rate-limit.ts`:

| Action                                | Global        | Per IP      | Per email or account    |
| ------------------------------------- | ------------- | ----------- | ----------------------- |
| Register                              | 300 / hour    | 5 / hour    | -                       |
| Salt step of the login                | 3000 / 10 min | 30 / 10 min | -                       |
| Login                                 | 3000 / 10 min | 20 / 10 min | 10 / 10 min per email   |
| Recovery (both steps)                 | 300 / hour    | 10 / hour   | 5 / hour per email      |
| Password change, upgrade, deletion    | -             | -           | 10 / hour per account   |
| Extraction (`/api/extract`, `/image`) | 30 000 / day  | -           | 60 / 10 min per account |

The Workers Rate Limiting binding was not used: it is approximate, per location, and its
availability on the Free plan is not verified. Over a limit the API answers 429 `RATE_LIMITED`;
the account routes add `Retry-After`.
