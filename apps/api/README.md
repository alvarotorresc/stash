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

### X and TikTok

Both use the official oEmbed endpoint plus the page of the post, downloaded in parallel; either can
fail without losing the save, and only when both fail does the request fail. No third-party
service sees the URL. Checked on 2026-11-11 from the Cloudflare network (`wrangler dev --remote`)
with the User-Agent below:

- **X.** `publish.twitter.com/oembed` answers a 301 to `publish.x.com` (followed, each hop checked)
  and then the text, author and date. The page of the post answers its Open Graph tags, with the
  text and `og:image` (the photo, or the video thumbnail). On a post with no media, `og:image` is
  the author's avatar, which the reader discards.
- **TikTok.** `tiktok.com/oembed` answers only an iframe: no title, author or `thumbnail_url`. The
  video page has no useful meta tags either (its title is "TikTok - Make Your Day"), but it embeds
  the state it hydrates from (`webapp.video-detail`) with the caption, author, cover and date. The
  reader uses oEmbed fields if TikTok brings them back and falls back to that state, which is not a
  documented interface: if it changes or a video is not public (`statusCode` other than 0), the
  link is kept as a preview with no text.
- **TikTok share links** (`vm.tiktok.com`, `vt.tiktok.com`, `tiktok.com/t/<code>`) are followed
  until a video address and then rebuilt as `https://www.tiktok.com/@<account>/video/<id>`, which
  drops the parameters that identify who shared the link. When they end on the home page (a gone
  link) the answer is the bare link.
- There is no host allow list in the proxy: `url-guard.ts` is a deny list, so no host had to be
  added. `hostIs(url, 'tiktok.com')` only chooses the adapter, and the URLs sent to TikTok are built
  from the account and the id, never from the rest of the link.
- **Images.** The covers are served by `pbs.twimg.com` (stable) and by TikTok's CDN (signed, they
  expire in about two days), and `POST /api/extract/image` downloads both. The client asks for it
  right after reading a link, reduces the image on the device and keeps it encrypted inside the
  item, so the app never loads an image from a third party. The proxy accepts only JPEG, PNG,
  WebP, GIF and AVIF (declared type and first bytes must agree; never SVG), at most 5 MiB.
  Images count in the same `extract` limits as pages (60 every 10 minutes per account, 6 000 a
  day for all), so a save with an image uses two of them. Those limits already bound the D1 cost
  of extraction (2 rows each), so the write budget below does not change; the thumbnail travels in
  the write that stores the read result, and filling an older item is one more record write, at
  most 10 per sync and about 3 rows each, inside the `recordsPush` caps.

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

A session token alone never gets the wrapped data key: `GET /api/account` returns only the
email, salt, parameters and creation date. Otherwise a stolen token would let anyone try
passwords offline, with no rate limit. Changing the password takes two steps, both proven with
the current login key and counted per account: `POST /api/account/password/begin` returns the
wrapped data key, as the login does, and `PUT /api/account/password` stores the new setup.

### The pepper

`PEPPER` keys every server-side digest through subkeys per purpose: login and recovery key
hashes, session token hashes, fake salts for unknown emails and rate limit keys. Generate it
with `openssl rand -base64 48`; only its length is checked.

**Known limitation: no rotation.** Changing the pepper invalidates every stored login and
recovery hash and every session, so nobody could log in or recover. Rotating it would need a
pepper version column on users and sessions, both peppers available for a while, and each hash
redone at the account's next login. That is not part of the first version. If the pepper leaks
with the database, the login keys and tokens stay safe (they carry 256 bits); what is lost is
the fake salt, which then reveals which emails have an account, and the rate limit keys, from
which emails and IPs can be brute-forced.

### Requests from other sites

The API answers no CORS headers and its `OPTIONS` preflight gets 405, so a page on another
origin cannot send a request a browser would preflight. Two checks close what is left:

- Every route with a body requires `Content-Type: application/json` (a `charset` is allowed)
  and answers 415 `UNSUPPORTED_MEDIA_TYPE` otherwise, before counting the request. A
  `text/plain` or form POST would be a "simple" request that browsers send across origins
  without a preflight, spreading abuse over the IPs of another site's visitors.
- Any `/api/*` request with `Sec-Fetch-Site: cross-site` answers 403 `CROSS_SITE_REQUEST`.
  Clients that are not browsers do not send the header and go through.

#### The browser extension

The extension calls the API from its own origin and carries a Bearer token, so one exception
lets it through: a request marked `cross-site` is accepted when its `Origin` is exactly
`chrome-extension://<32 letters a-p>` or `moz-extension://<UUID>`. Any other origin, a lookalike
(`chrome-extension://<id>.evil.example`, a path, another scheme) or the opaque `null` still gets 403.

Why this is safe:

- **The API uses no cookies.** Nothing authenticates a request by itself: every route that
  needs a session reads a Bearer token from `Authorization`, which a page on another site can
  neither read nor attach. That is why a cross-site request could never act as the user (CSRF
  does not apply); what the check closes is abuse, such as spreading unauthenticated requests
  over the IPs of another site's visitors. The extension sends `credentials: 'omit'`, so no
  cookie travels with its requests either.
- **A page cannot forge the origin.** `Origin` is a forbidden header name: only the browser
  sets it, and extension schemes belong to installed extensions, not to web content.
- **An extension of another author** with access to this host could send the same origin shape.
  It could equally call the API with any token it obtained, so the exception adds nothing to
  what the Bearer token already guards, and the rate limits still apply.
- **The Chrome id is not pinned**, because Firefox's UUID is random per installation and cannot
  be (the exception has to accept that shape anyway), so pinning one of the two would add no
  protection. The real defences are the Bearer token, the JSON-only body rule and the rate
  limits above.
- **No CORS headers are added.** Extension requests to a host in the extension's
  `host_permissions` are not subject to CORS, and the `OPTIONS` preflight stays 405.

Not verified: which `Sec-Fetch-Site` value each browser sends for these requests (it may be
`cross-site`, `same-site` or `none`). The exception covers `cross-site`; the other values passed
before. Check it with the packaged extension in Chrome and in Firefox.

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
| Extraction (`/api/extract`, `/image`) | -           | 60 / 10 min per account            | 6000 / day    |
| Sync pull (`GET /api/records`)        | -           | 300 / 10 min per account           | 3000 / day    |
| Sync push (`POST /api/records`)       | -           | 6000 rows / day per account        | 24 000 rows / |
|                                       |             |                                    | day           |

Register, login, recovery and the password proofs also share a **daily budget of 5000
requests**. Spent, nobody can register, log in or recover until 00:00 UTC, but open sessions,
extraction and sync keep working. The salt step of the login (`/api/auth/prelogin`) is not
counted in D1: it protects no secret (unknown emails get a stable fake salt) and is left to the
WAF rule below.

How a request is counted:

1. Every bucket of the request is read. A request has a cost, 1 unless said otherwise, and adds
   it to each bucket. If any bucket has no room for it, the answer is 429 `RATE_LIMITED` with
   `Retry-After`, and nothing is written.
2. The specific buckets (IP, account) are counted with an upsert that does not touch a full
   bucket.
3. Only if they all had room are the global bucket and the daily budget counted. A client over
   its own limit never fills what every other client shares, even with concurrent requests.
4. Failed login keys and recovery keys are then counted per email and per email and IP. A right
   key never counts, so nobody can lock an owner out by guessing; a targeted lockout needs many
   IPs.

A push is counted by its weight: the rows it can write, from the validated body alone, so a
refused push costs no read of the records either. It is 3 for the request's own counters, 4 per
`create` or `put` (a put may insert a new record), 3 per `delete`, and 1 more when the push may
create the account's first record. The heaviest push, 100 new records, weighs 404. A save or an
edit pushed alone weighs 8, a delete 6; batched, an operation costs about 4.

The Workers Rate Limiting binding was not used: it is approximate, per location, and its
availability on the Free plan is not verified.

### Daily D1 write budget

On the Workers Free plan, D1 allows 100 000 written rows a day. Past that, **every query fails**
until 00:00 UTC, so the limits are sized to keep the worst day of abuse well under it.
`test/write-budget.test.ts` measures the rows each statement writes on the real schema and
recomputes this sum from the limits, so raising a cap past the ceiling fails the tests.

Measured costs: counting a bucket writes 1 row (`rate_limits` has no rowid and no secondary
index), a session 2 rows (row and `user_id` index), a user 3 rows and updating a user 1 row.
A new record writes 4 rows (row, primary key, `version` index and its `record_counts` update; 5
for the first record of an account, which creates that row), an edit or a delete of a record 3.
A `record_counts` row is 2 rows and the tombstone of a deleted account 1. Deleting a row is
charged like inserting it. Keys of IPs, emails and accounts are assumed new on every request
(the attacker rotates them), so each costs its insert and its later deletion: 2.

| Worst accepted request | Rows                                                             |
| ---------------------- | ---------------------------------------------------------------- |
| Register               | IP 2 + global 1 + budget 1 + user 3 + session 2×2 = **11**       |
| Login                  | IP 2 + global 1 + budget 1 + session 2×2 (or failures 4) = **8** |
| Recovery               | IP 2 + global 1 + budget 1 + user update 1 + session 4 = **9**   |
| Password proof         | account 2 + budget 1 + deletion (user 3 + counts 2 + tombstone   |
|                        | 1; a password change rewrites the user, 1) = **9**               |
| Extraction             | account 1 + global 1 = **2** (stable keys, see below)            |
| Sync pull              | account 2 + global 1 = **3**                                     |
| Sync push              | its weight, at most 3 + 100 records × 4 + first record 1 = 404   |

| Per day                                                   | Rows       |
| --------------------------------------------------------- | ---------- |
| Budget: 100 registrations × 11 + 4 900 other requests × 9 | 45 200     |
| Extraction: 6 000 × 2                                     | 12 000     |
| Sync pulls: 3 000 × 3                                     | 9 000      |
| Sync pushes: the global cap, already in rows              | 24 000     |
| Purge of deleted accounts: 1 000 records × 4              | 4 000      |
| **Worst case**                                            | **94 200** |

The test checks the total against a ceiling of 95 000, a 5 % margin under the quota. The weights
are checked against the measured costs too, so a schema change that makes a record cost more
fails until the weights follow.

What fits in a day: about 3 000 saves or edits pushed one by one for every account together, or
6 000 operations in batches, and 750 single saves for one account. Saving a link that was already
saved reads it again (one extraction and, if the read finds something new, one edit), so it costs
the same as saving it the first time. A few people saving and
sorting tens or hundreds of items a day each stay well inside it. Spent, nobody can push until
00:00 UTC; pulls and the local copy keep working. A first upload of a full account (5 000
records, about 20 000 rows) takes four days at the per-account cap.

The sweep (a cron trigger at 04:17 UTC) deletes at most 25 000 rows per table in a run, above
what a day of requests can leave behind, so a backlog never spends the quota in one go. Extraction assumes an
account's key is inserted and swept at most once a day: it holds while the accounts that extract
in a day are few next to the extractions. Any new rate-limited action must be added to the test.

### Account deletion and the purge

Deleting an account is one transaction of a few rows, whatever the account holds: it removes
the user (and with it the wrapped data keys), its sessions, its `record_counts` row and its rate
limit counters, and writes a tombstone with its id to `deleted_users`. From that moment the
account does not exist: no session names it, and its records stay encrypted under a key that
only the deleted user row wrapped.

The records themselves are purged by the daily sweep, at most 1 000 per run, so a full account
is gone within five days and deleting many accounts on the same day costs the quota no more than
one run. Until then they cannot be read by anyone:

- Every records query is filtered by the account of the session, and the sessions went with the
  user.
- Tombstones are kept for good (one row per deleted account, a random id and nothing else), and
  a trigger refuses a new user with a tombstoned id, so a new account can never inherit them.
- `records` has no foreign key to `users`, or deleting the user would cascade to every record
  in the same transaction. A trigger refuses a record whose user does not exist instead, which
  also stops a push that passed its session check just before the deletion.

The migration that creates `records` (`0002`) was changed in place instead of adding a new one:
it had not reached `main` yet, only the branch that introduces sync, and removing a foreign key
in a later migration would mean rebuilding the table.

### Quotas

An account keeps at most 5 000 records and 25 MiB of blobs (5 KiB per record on average). The D1
Free plan caps a database at 500 MB, so about 20 full accounts fit.

**Known limit:** deleted records stay as tombstones and count towards the 5 000, so an account
that saves and deletes a lot reaches the cap with fewer live items. Freeing them would need
compacting tombstones that every device has already pulled.

**Limit that remains:** the Workers Free plan also caps requests at 100 000 a day. An attacker
can still spend that quota; only the WAF rule keeps abuse from reaching the Worker.

### Queries per invocation

The Workers Free plan allows 50 D1 queries per Worker invocation, and 50 subrequests, which D1
queries and outbound fetches share. A `db.batch()` counts as one query however many statements it
holds ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)), so a push of 100
operations, written in one batch, costs the same query as a push of one.
`test/queries-per-invocation.test.ts` counts the queries of each route against a cap of 45:

| Route                                      | D1 queries | Outbound fetches |
| ------------------------------------------ | ---------- | ---------------- |
| Register, login, recovery, password proofs | 5          | -                |
| Password change, account deletion          | 6          | -                |
| Push (100 operations), pull (500 records)  | 6          | -                |
| Extraction                                 | 4          | at most 12       |
| Daily sweep and purge (1 000 records)      | 1          | -                |

A request counts its session (1 query) and its rate limit (a read and up to two batches), then
reads and writes in batches. Extraction downloads at most two documents (an X post's oEmbed and
page, or a short link and its target), each with up to five redirects. The purge removes its
records with one `DELETE … LIMIT`, not one statement per record.

### Before publishing: WAF rate limiting rule

Configure, in the Cloudflare dashboard of the zone (Security, WAF, Rate limiting rules), the one
rule the Free plan includes. Requests it blocks never reach the Worker nor D1:

- Expression: `starts_with(http.request.uri.path, "/api/")`
- Characteristics: IP. Period: 10 seconds. Requests: 20. Action: block for 10 seconds.

It is the only limit on `/api/auth/prelogin`, which costs reads only, and the first barrier for
every other route.
