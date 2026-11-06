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

| Action                                | Per IP      | Per account or email               | Global        |
| ------------------------------------- | ----------- | ---------------------------------- | ------------- |
| Register                              | 5 / hour    | -                                  | 100 / day     |
| Login                                 | 20 / 10 min | failures: 5 / 10 min per email+IP, | 3000 / 10 min |
|                                       |             | 50 / hour per email                |               |
| Recovery (both steps)                 | 10 / hour   | failures: 5 / hour per email+IP,   | 300 / hour    |
|                                       |             | 20 / hour per email                |               |
| Password change, upgrade, deletion    | -           | 10 / hour per account              | -             |
| Extraction (`/api/extract`, `/image`) | -           | 60 / 10 min per account            | 10 000 / day  |

Register, login, recovery and the password proofs also share a **daily budget of 5000
requests**. Spent, nobody can register, log in or recover until 00:00 UTC, but open sessions,
extraction and sync keep working. The salt step of the login (`/api/auth/prelogin`) is not
counted in D1: it protects no secret (unknown emails get a stable fake salt) and is left to the
WAF rule below.

How a request is counted:

1. Every bucket of the request is read. If any is full, the answer is 429 `RATE_LIMITED` with
   `Retry-After`, and nothing is written.
2. The specific buckets (IP, account) are counted with an upsert that does not touch a full
   bucket.
3. Only if they all had room are the global bucket and the daily budget counted. A client over
   its own limit never fills what every other client shares, even with concurrent requests.
4. Failed login keys and recovery keys are then counted per email and per email and IP. A right
   key never counts, so nobody can lock an owner out by guessing; a targeted lockout needs many
   IPs.

The Workers Rate Limiting binding was not used: it is approximate, per location, and its
availability on the Free plan is not verified.

### Daily D1 write budget

On the Workers Free plan, D1 allows 100 000 written rows a day. Past that, **every query fails**
until 00:00 UTC, so the limits are sized to keep the worst day of abuse well under it.
`test/write-budget.test.ts` measures the rows each statement writes on the real schema and
recomputes this sum from the limits, so raising a cap past the ceiling fails the tests.

Measured costs: counting a bucket writes 1 row (`rate_limits` has no rowid and no secondary
index), a session 2 rows (row and `user_id` index), a user 3 rows and updating a user 1 row.
Deleting a row is charged like inserting it. Keys of IPs, emails and accounts are assumed new on
every request (the attacker rotates them), so each costs its insert and its later deletion: 2.

| Worst accepted request | Rows                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| Register               | IP 2 + global 1 + budget 1 + user 3 + session 2×2 = **11**       |
| Login                  | IP 2 + global 1 + budget 1 + session 2×2 (or failures 4) = **8** |
| Recovery               | IP 2 + global 1 + budget 1 + user update 1 + session 4 = **9**   |
| Password proof         | account 2 + budget 1 + user 3 = **6**                            |
| Extraction             | account 1 + global 1 = **2** (stable keys, see below)            |

| Per day                                                   | Rows       |
| --------------------------------------------------------- | ---------- |
| Budget: 100 registrations × 11 + 4 900 other requests × 9 | 45 200     |
| Extraction: 10 000 × 2                                    | 20 000     |
| **Worst case**                                            | **65 200** |

That leaves about 35 000 rows a day for sync and the daily sweep. Extraction assumes an
account's key is inserted and swept at most once a day: it holds while the accounts that extract
in a day are few next to the extractions. Any new rate-limited action must be added to the test.

**Limit that remains:** the Workers Free plan also caps requests at 100 000 a day. An attacker
can still spend that quota; only the WAF rule keeps abuse from reaching the Worker.

### Before publishing: WAF rate limiting rule

Configure, in the Cloudflare dashboard of the zone (Security, WAF, Rate limiting rules), the one
rule the Free plan includes. Requests it blocks never reach the Worker nor D1:

- Expression: `starts_with(http.request.uri.path, "/api/")`
- Characteristics: IP. Period: 10 seconds. Requests: 20. Action: block for 10 seconds.

It is the only limit on `/api/auth/prelogin`, which costs reads only, and the first barrier for
every other route.
