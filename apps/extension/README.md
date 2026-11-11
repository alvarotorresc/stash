# @stash/extension

Stash for the desktop browser: Chrome/Chromium and Firefox, both on Manifest V3, built with
[WXT](https://wxt.dev) and Svelte.

- **Popup**: logs in, saves the open tab and lets you classify it, and lists and reads what is
  saved. It reads the page directly from the tab (address, title, meta tags and HTML) and turns
  the HTML into reader mode on the device, so the proxy is not asked for it. Saving a link that
  already exists says "Ya estaba guardado" and creates nothing.
- **Context menu** ("Guardar en Stash") on any link: the page behind the link is not open, so only
  its address is saved and the proxy reads it later, when the popup opens.

## Status

Wired to the real client (`@stash/client`, the same one the PWA uses): login, unlock, encrypted
sync, extraction and the reader. The account is the PWA's: same email, same drawer.

**Creating the account** is done in the web app: the popup links to it. The recovery code is shown
once, and a popup closes as soon as it loses focus, so it could be lost while the account already
exists. Logging in, unlocking and saving all work in the popup.

## How the contexts work

The popup and the background run separately and each creates its own client (`lib/services.ts`).
They share the session in `storage.local` and the data key and encrypted cache in the extension's
own IndexedDB, never memory.

- **Argon2id runs in the popup** (a module Web Worker bundled as an extension file), never in the
  background: Chrome's service worker has no Web Workers and can stop at any time.
- **Session**: the Bearer token and the email, in `storage.local` (`lib/storage.ts`). Only the
  extension's pages and background can read it. A record that does not look like a session is
  deleted when read.
- **Data key**: the client's non-extractable `CryptoKey` in the extension's IndexedDB, valid 30
  days from the last password entry, like the PWA.
- **Requests** go to `https://stash.alvarotc.com` with `credentials: 'omit'` and a Bearer token.
  The API sees the extension's own origin (see its README for the exception).
- **Log out** closes the session on the server and clears the token, the data key, the encrypted
  cache, the offline queue and the links waiting from the menu.

### Context menu without an unlocked session

Each click makes a fresh client and checks the session first, so a log out in the popup takes
effect at once (a long-lived background would keep the data key in memory).

- **Unlocked**: the link is saved with the real client, without reading it (the background has no
  DOM). If it cannot be saved right away it is queued in the encrypted queue like any save.
- **Not logged in, expired, logged out, or saving threw**: the address goes to a small list in
  `storage.local` (50 links at most, no repeats, http(s) only) and the toolbar button shows how
  many wait. Opening the popup and unlocking saves them one by one and removes each only after it
  is saved; a failure leaves the rest for next time.

Those waiting addresses are plain text in the profile until saved: there is no key to encrypt
them with while locked. Logging out deletes them.

## Layout

| Path                        | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `entrypoints/background.ts` | Thin wrapper: wires the message listener and the context menu.       |
| `entrypoints/popup/`        | The popup (`App.svelte`) and its bootstrap.                          |
| `lib/tab.ts`                | Reads the active tab: the injected function and the result checks.   |
| `lib/messages.ts`           | Message types, their parser and the sender check.                    |
| `lib/router.ts`             | One handler for every message, and the `runtime.onMessage` listener. |
| `lib/contextMenu.ts`        | "Guardar en Stash" on links; a click becomes a save-link message.    |
| `lib/services.ts`           | Builds the popup's service and the background's actions.             |
| `lib/popupService.ts`       | The popup's service over `@stash/client`.                            |
| `lib/client.ts`             | The client for an extension context: API origin, no cookies.         |
| `lib/storage.ts`            | `SessionStore` over `storage.local`, and the links waiting.          |
| `lib/service.ts`, `mock.ts` | The service interface and the in-memory example (component tests).   |

## Commands

From the repository root, after `pnpm install`:

```sh
pnpm --filter @stash/extension dev          # Chrome with live reload
pnpm --filter @stash/extension dev:firefox  # Firefox with live reload
pnpm --filter @stash/extension build        # .output/chrome-mv3 and .output/firefox-mv3
pnpm --filter @stash/extension zip          # store zips, plus the Firefox sources zip
pnpm --filter @stash/extension test         # tests with coverage
```

`zip` writes three files to `.output/`:

- `stashextension-<version>-chrome.zip`: for the Chrome Web Store, or to load unpacked.
- `stashextension-<version>-firefox.zip`: for AMO.
- `stashextension-<version>-sources.zip`: the sources AMO asks for. It starts at the repository
  root and only holds an allowlist (root manifests and lockfile, `apps/extension`, `packages/core`,
  `packages/ui`); see `zip.includeSources` in `wxt.config.ts`.

## Load it in a browser to try it

**Chrome / Chromium**

1. `pnpm --filter @stash/extension build:chrome`, or unzip the Chrome zip into a folder.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** and pick `apps/extension/.output/chrome-mv3` (or the unzipped folder).
4. Pin Stash from the puzzle icon. Open any web page and click it to save the tab; right-click a
   link for "Guardar en Stash".

**Firefox** (140 or later)

1. `pnpm --filter @stash/extension build:firefox`.
2. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Pick `apps/extension/.output/firefox-mv3/manifest.json`. It stays until Firefox closes.
4. In Manifest V3, Firefox may treat host permissions as optional: logging in asks for the Stash
   host first (no new permission, it is the declared one). If calls to the API still fail, check
   that `stash.alvarotc.com` is allowed under `about:addons` → Stash → Permissions.

Release Firefox only installs signed add-ons; for daily use without the store, sign the Firefox
zip as an unlisted add-on on AMO.

## Rebuilding from the sources zip (AMO reviewers)

Requirements: Node.js 26.13.0 and pnpm 12.16.1 (see the root `package.json`).

```sh
unzip stashextension-<version>-sources.zip -d stash && cd stash
pnpm install --frozen-lockfile --ignore-scripts
cd apps/extension && pnpm build:firefox
# Output: apps/extension/.output/firefox-mv3, identical to the submitted zip.
```

`--ignore-scripts` skips the root `prepare` script, which installs git hooks and is not needed to
build. The build is reproducible: Svelte hashes component paths relative to the repository root
(`svelte.vite.compilerOptions.rootDir` in `wxt.config.ts`), so the output does not depend on where
the sources are unpacked.

## Permissions

| Permission                            | Why                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| `activeTab`                           | Read the open tab only after the user clicks the toolbar button. No standing access. |
| `scripting`                           | Run the one function that reads that tab (`capturePage` in `lib/tab.ts`).            |
| `contextMenus`                        | "Guardar en Stash" on links.                                                         |
| `storage`                             | The session token, and the links picked from the menu while locked.                  |
| `https://stash.alvarotc.com/*` (host) | The Stash API. The only host the extension talks to. Used for every request.         |

There is no `<all_urls>`, no content script and no access to other sites: a link saved from the
context menu is fetched by the proxy, not by the extension.

The extension pages declare
`content_security_policy.extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"`
on both browsers: key derivation runs as WebAssembly in the popup (never in the background, which
has no workers in Chrome and can be stopped at any time).

Firefox also declares the add-on id `stash@alvarotc.com` (AMO assigns none to Manifest V3 add-ons)
and, in its built-in data consent, `browsingActivity` and `websiteContent` as required: saved links
and the content of saved pages leave the device, end-to-end encrypted, and links saved from the
menu go through the proxy.

## Security notes

- **Reading the tab.** The injected function runs in the isolated world of the top frame only.
  The browser serializes it as text, so it uses nothing outside its body. Everything it returns is
  untrusted page data: `toCapturedPage` type-checks every field, caps sizes (2 MiB of HTML, 64 meta
  tags, 500-character title), takes the address from the tab rather than from the page, and drops
  the capture when the page navigated while it was read. The HTML is never rendered as is: reader
  mode parses and sanitizes it in the service. Pages that cannot be scripted (stores, the PDF
  viewer) are still saved with their address and title.
- **Messages.** Every message is untrusted input. `parseMessage` accepts only known shapes with an
  http(s) address and drops any extra key. The background answers only the extension's own pages:
  same extension id, no tab, and an address under `runtime.getURL('')`. Scripts injected into tabs
  carry the extension id too, so the id alone is not enough. No `externally_connectable`, so web
  pages cannot message the extension. Failures answer `{ ok: false }` without details.
- **Context menu.** A click goes through the same parser and handler as a message from the popup.
  Only http(s) links are saved; `javascript:`, `data:` and `file:` links are ignored.
- **Token and key.** The token is in `storage.local`: readable by the extension's own code, not
  by web pages or other extensions, and not encrypted at rest (like the PWA's `localStorage`).
  The data key is non-extractable and, as the core documents, not encrypted on disk either. The
  popup and the background load no remote code (`script-src 'self' 'wasm-unsafe-eval'`) and
  sanitize every saved page before showing it (`sanitizeStoredHtml`, images never load), so the
  defence is that no foreign script runs in the extension's pages.
- **Reading pages.** The HTML read from the tab is parsed on the device by the reader (Readability
  and DOMPurify) in the popup; it never reaches `innerHTML` unsanitized.
- **Requests.** `credentials: 'omit'` and a Bearer token: no cookie travels, so nothing rides on
  the browser's ambient credentials.
- **Permissions.** Logging in calls `permissions.request` for the host that is already declared;
  it needs the click and shows no prompt when the permission is granted.

## API: requests from the extension

The API refuses `/api/*` requests marked `Sec-Fetch-Site: cross-site`, except those whose `Origin`
is exactly `chrome-extension://<32 letters>` or `moz-extension://<uuid>`. The reasoning (the API
uses no cookies; a page cannot forge `Origin`) is in `apps/api/README.md`. The Chrome id is not
pinned there because Firefox's UUID is random per installation.

To verify with the packaged extension: which `Sec-Fetch-Site` each browser sends for these
requests, and (Firefox) whether the host permission is granted at install.
