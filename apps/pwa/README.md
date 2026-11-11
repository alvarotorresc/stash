# @stash/pwa

The Stash progressive web app: Svelte 5 + Vite, with a service worker built by vite-plugin-pwa in
`injectManifest` mode (`src/sw.ts`). On Android it receives links from the system share sheet.

The screens talk to one interface, `StashService` (`src/lib/service.ts`). The app runs on the real
service (`src/lib/real`), built on `@stash/client`: accounts, end-to-end encryption, the encrypted
cache, sync, the extraction proxy and the reader on the device. The in-memory example service
(`src/lib/mock`) is only for tests and, in development, with `VITE_STASH_MOCK=1`. Production builds
never include it.

### Session and keys

- The session token lives in `localStorage` (`createWebStorageSessionStore`), so the app stays
  signed in across reloads. The data key is a non-extractable `CryptoKey`, kept in memory once
  unlocked and remembered by the core's IndexedDB store for 30 days from the last password entry:
  opening the app unlocks it without the password. Both rely on no foreign script running, which
  the strict CSP in `public/_headers` enforces.
- Logging out or deleting the account forgets the data key, the session, the encrypted cache and
  the offline queue. If the server closes the session (password changed on another device), the
  app goes back to the sign-in screen with the email filled in and keeps the queue for the next
  login.
- Saved content is shown as text, or as HTML passed through `sanitizeStoredHtml` right before it
  is rendered. Images from saved pages never load from their site.

## Scripts

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Development server; `/api` goes to `wrangler dev`    |
| `pnpm build`     | Production build in `dist/`, service worker included |
| `pnpm preview`   | Serves the build locally                             |
| `pnpm typecheck` | svelte-check for the app, tsc for the worker         |
| `pnpm test`      | Vitest with coverage (85 % threshold)                |

In development, run the API with `pnpm --filter @stash/api dev` (port 8787) next to `pnpm dev`.
To work on the screens without it, start with `VITE_STASH_MOCK=1 pnpm dev` (add `?lento` to the
URL to slow the example data down).

## How sharing works

1. The manifest declares a `share_target`: Android sends a `POST` with `multipart/form-data` to
   `/share` carrying `title`, `text` and `url`.
2. The service worker answers that `POST` itself (`src/share.ts`). It takes the `url` field when it
   is an http(s) link, otherwise the first http(s) link inside `text`, and replies `303` to
   `/?share=<link>`. Anything else (no link, `javascript:`, `intent:`, credentials in the link, a body
   that is not a form) redirects to `/` with nothing.
3. The service worker serves the cached app for `/?share=…`, so the shared link never reaches the
   server, and sharing works offline.
4. The app validates the link again, cleans the address bar and saves it at once, then asks the
   proxy for the page and reads it on the device in the background. The sheet that opens only
   offers to classify; closing it without touching anything leaves the item under
   «Sin clasificar». Without connection (or if the server fails) the link waits in the encrypted
   queue and uploads when the connection is back.

Security headers (CSP, `Referrer-Policy`, `nosniff`, HSTS) live in `public/_headers`, which Cloudflare
Pages applies to every path.

## Testing the share target on a real Android phone

The share sheet only lists **installed** web apps, and only Chrome (or another Chromium browser) on
Android supports it. Firefox for Android ignores `share_target`.

1. Open one of these in Chrome on the phone:
   - the Cloudflare Pages preview of the branch (`https://<hash>.<project>.pages.dev`, the exact URL
     is in the Pages deployment of the pull request), or
   - `https://stash.alvarotc.com` once the branch is merged.
2. Menu ⋮ → **Install app** (or **Add to home screen** → Install). Each origin installs as a separate
   app, so the preview and production can coexist.
3. If an older install exists without sharing, uninstall it and install again: Android picks up
   manifest changes slowly.
4. Open the app once from the home screen, sign in (or create the account), then close it.
5. Share from each app and check that Stash opens with the sheet «Guardado» and the right link:

   | App       | How to share                   | What it usually sends  |
   | --------- | ------------------------------ | ---------------------- |
   | X         | Post → share icon → Share via… | The link inside `text` |
   | Instagram | Post → ⋯ / paper plane → Share | The link inside `text` |
   | Reddit    | Post → Share → Share via…      | A short `/s/…` link    |
   | Chrome    | Menu ⋮ → Share                 | The page in `url`      |

6. Close the sheet without touching anything: the item must appear under «Sin clasificar».
7. Repeat one share in airplane mode: the sheet must say «En cola».

What each app sends is not documented anywhere official; the table is what is expected and the test
on the phone is what settles it.

### Thumbnails and order

- The list and the reading view show the decrypted thumbnail from a `blob:` URL created in memory
  (the CSP allows `img-src 'self' blob: data:`). The URLs are kept by the service, shared by every
  screen, and revoked when the image changes, the item is deleted or the session ends; there is
  no image request to a third party, so `connect-src` stays `'self'`. Without a thumbnail the row
  keeps its color tone.
- Under Leídos and Descartados items are ordered by when their state last changed
  (`statusChangedAt`), newest first; an item that never recorded a change falls back to its saved
  date.
- Export includes each thumbnail as `{ type, base64 }`, or `null`.

### Debugging

- Connect the phone by USB, enable USB debugging and open `chrome://inspect` on the computer to see
  the installed app's console, its service worker and the requests.
- A new version of the service worker waits until every Stash window is closed. After deploying,
  close the app completely (recent apps → swipe it away) and open it again.
