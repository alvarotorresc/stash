# @stash/pwa

The Stash progressive web app: Svelte 5 + Vite, with a service worker built by vite-plugin-pwa in
`injectManifest` mode (`src/sw.ts`). On Android it receives links from the system share sheet.

Until the real client exists, the app runs on example data in memory (`src/lib/mock`).

## Scripts

| Command          | Description                                          |
| ---------------- | ---------------------------------------------------- |
| `pnpm dev`       | Development server (add `?lento` to slow the mock)   |
| `pnpm build`     | Production build in `dist/`, service worker included |
| `pnpm preview`   | Serves the build locally                             |
| `pnpm typecheck` | svelte-check for the app, tsc for the worker         |
| `pnpm test`      | Vitest with coverage (85 % threshold)                |

## How sharing works

1. The manifest declares a `share_target`: Android sends a `POST` with `multipart/form-data` to
   `/share` carrying `title`, `text` and `url`.
2. The service worker answers that `POST` itself (`src/share.ts`). It takes the `url` field when it
   is an http(s) link, otherwise the first http(s) link inside `text`, and replies `303` to
   `/?share=<link>`. Anything else (no link, `javascript:`, `intent:`, credentials in the link, a body
   that is not a form) redirects to `/` with nothing.
3. The service worker serves the cached app for `/?share=…`, so the shared link never reaches the
   server, and sharing works offline.
4. The app validates the link again, cleans the address bar and saves it at once. The sheet that
   opens only offers to classify; closing it without touching anything leaves the item under
   «Sin clasificar».

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
4. Open the app once from the home screen, then close it. With the mock it starts signed in, on
   example data that resets every time the app opens.
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

### Debugging

- Connect the phone by USB, enable USB debugging and open `chrome://inspect` on the computer to see
  the installed app's console, its service worker and the requests.
- A new version of the service worker waits until every Stash window is closed. After deploying,
  close the app completely (recent apps → swipe it away) and open it again.
