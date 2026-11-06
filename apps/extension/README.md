# @stash/extension

Stash for the desktop browser: Chrome/Chromium and Firefox, both on Manifest V3, built with
[WXT](https://wxt.dev) and Svelte.

- **Popup**: saves the open tab and lets you classify it. It reads the page directly from the tab
  (address, title, meta tags and HTML for reader mode on the device).
- **Context menu** ("Guardar en Stash") on any link: the page behind the link is not open, so only
  its address is saved and the service extracts it through the proxy.

## Status

Accounts, unlock and sync are not wired yet. The popup and the background use the in-memory
example service (`lib/mock.ts`); only reading the open tab is real. `lib/services.ts` is the one
place where the service is picked: the real client goes there and nothing else changes.

The popup and the background run in separate contexts and each creates its own service. With the
mock they do not share state, so a link saved from the context menu does not show up in the popup.

## Layout

| Path                        | What it does                                                         |
| --------------------------- | -------------------------------------------------------------------- |
| `entrypoints/background.ts` | Thin wrapper: wires the message listener and the context menu.       |
| `entrypoints/popup/`        | The popup (`App.svelte`) and its bootstrap.                          |
| `lib/tab.ts`                | Reads the active tab: the injected function and the result checks.   |
| `lib/messages.ts`           | Message types, their parser and the sender check.                    |
| `lib/router.ts`             | One handler for every message, and the `runtime.onMessage` listener. |
| `lib/contextMenu.ts`        | "Guardar en Stash" on links; a click becomes a save-link message.    |
| `lib/services.ts`           | Injection point for the Stash service (mock today).                  |
| `lib/service.ts`, `mock.ts` | The service interface and the in-memory example.                     |

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
4. In Manifest V3, Firefox treats host permissions as optional: if calls to the API fail once
   they exist, check that `stash.alvarotc.com` is allowed under `about:addons` → Stash →
   Permissions (to verify when the real client is wired).

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
| `storage`                             | Session and settings, once accounts are wired.                                       |
| `https://stash.alvarotc.com/*` (host) | The Stash API. The only host the extension talks to.                                 |

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

## API: requests from the extension

The API refuses any `/api/*` request marked `Sec-Fetch-Site: cross-site` (403
`CROSS_SITE_REQUEST`), because it only serves the PWA on its own origin. The extension calls it
from its own origin (`chrome-extension://<id>` or `moz-extension://<uuid>`), so when the real
client is wired the API needs an exception for those requests. Not implemented here; to settle
then:

- Which `Sec-Fetch-Site` and `Origin` each browser sends for an extension request to a host it has
  permission for is not verified. It has to be checked in Chrome and in Firefox.
- The `moz-extension://` origin changes with every Firefox install, so an allowlist of origins
  cannot be the defense. The real defense is the Bearer token; the exception should match the
  extension schemes, not fixed ids.
- CORS keeps allowing only the PWA origin unless the checks above show the extension needs it.
