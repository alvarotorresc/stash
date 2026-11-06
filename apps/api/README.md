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

The browser extension will call the API from its own origin. When it arrives, it needs an
explicit exception for that origin (CORS limited to it, and the cross-site check allowing it);
the bearer token stays the real defence.

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
| Sync pull (`GET /api/records`)        | -           | 300 / 10 min per account           | 3000 / day    |
| Sync push (`POST /api/records`)       | -           | 30 / 10 min per account            | 50 / day      |

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
A new record writes 4 rows (row, primary key, `version` index and its `record_counts` update; 5
for the first record of an account, which creates that row), an edit or a delete of a record 3.
Deleting a row is charged like inserting it. Keys of IPs, emails and accounts are assumed new on
every request (the attacker rotates them), so each costs its insert and its later deletion: 2.

| Worst accepted request | Rows                                                              |
| ---------------------- | ----------------------------------------------------------------- |
| Register               | IP 2 + global 1 + budget 1 + user 3 + session 2×2 = **11**        |
| Login                  | IP 2 + global 1 + budget 1 + session 2×2 (or failures 4) = **8**  |
| Recovery               | IP 2 + global 1 + budget 1 + user update 1 + session 4 = **9**    |
| Password proof         | account 2 + budget 1 + user 3 = **6**                             |
| Extraction             | account 1 + global 1 = **2** (stable keys, see below)             |
| Sync pull              | account 2 + global 1 = **3**                                      |
| Sync push              | account 2 + global 1 + 100 records × 4 + first record 1 = **404** |

| Per day                                                   | Rows       |
| --------------------------------------------------------- | ---------- |
| Budget: 100 registrations × 11 + 4 900 other requests × 9 | 45 200     |
| Extraction: 10 000 × 2                                    | 20 000     |
| Sync pulls: 3000 × 3                                      | 9 000      |
| Sync pushes: 50 × 404                                     | 20 200     |
| **Worst case**                                            | **94 400** |

The account and extraction routes stay under 70 000 rows and sync under 30 000; the test checks
both ceilings. A push is charged as if it carried `MAX_PUSH_RECORDS` (100) new records, so the
daily cap of 50 pushes for every account together is what bounds the record writes. It is low
for real use: once spent, nobody can push until 00:00 UTC (pulls and the local copy keep
working). Raising it needs counting a push by its operations instead of as one request.

The sweep (a cron trigger at 04:17 UTC) deletes at most 25 000 rows per table in a run, above
what a day of requests can leave behind, so a backlog never spends the quota in one go. Extraction assumes an
account's key is inserted and swept at most once a day: it holds while the accounts that extract
in a day are few next to the extractions. Any new rate-limited action must be added to the test.

**Limit that remains:** deleting an account removes all its records in one batch, up to
`MAX_RECORDS_PER_ACCOUNT` (20 000) rows of about 4 written rows each. Records pile up over many
days, so no daily cap bounds what deleting several full accounts on the same day costs, and it
can spend the whole quota. This sum does not include it; a lower per-account quota or a purge
spread over the daily sweep would.

**Limit that remains:** the Workers Free plan also caps requests at 100 000 a day. An attacker
can still spend that quota; only the WAF rule keeps abuse from reaching the Worker.

### Before publishing: WAF rate limiting rule

Configure, in the Cloudflare dashboard of the zone (Security, WAF, Rate limiting rules), the one
rule the Free plan includes. Requests it blocks never reach the Worker nor D1:

- Expression: `starts_with(http.request.uri.path, "/api/")`
- Characteristics: IP. Period: 10 seconds. Requests: 20. Action: block for 10 seconds.

It is the only limit on `/api/auth/prelogin`, which costs reads only, and the first barrier for
every other route.
