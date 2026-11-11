# @stash/client

What the PWA and the extension share to talk to Stash: the account client, the sync client, the
extraction proxy and the reader, wired together once. Plain TypeScript, imported from source.

`@stash/core` stays free of DOM code because the Worker imports it, and `@stash/reader` knows
nothing about the network. This package is the one place where the two meet, so neither app
repeats the wiring.

## Usage

```ts
import { createStash } from '@stash/client';
import { createWebStorageSessionStore } from '@stash/core';

const stash = createStash({ sessionStore: createWebStorageSessionStore(localStorage) });

if (await stash.session()) await stash.start(); // unlocked: cache, then sync in the background
await stash.save(url); // saved at once; read in the background
await stash.change((sync) => sync.classify(id, { priority: 'high' }));
stash.sync.listItems(); // reads go straight to the sync client
```

| Method                                        | What it does                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `session()`                                   | The session when the data key is unlocked too; `null` means "ask for the password".   |
| `lastEmail()`                                 | The email of the last session on the device, also once expired.                       |
| `register` / `login` / `recover`              | Password entries. `register` and `recover` return a recovery code to show once.       |
| `changePassword` / `logout` / `deleteAccount` | Logout and deletion forget the data key, the cache and the queue.                     |
| `start()` / `refresh()`                       | Load the cache (offline too) / upload the queue, pull and read unread links.          |
| `save(url, { read }?)`                        | Saves at once and reads the page in the background, or stores the `read` it is given. |
| `change(run)`                                 | Runs a change through the sync client, one at a time.                                 |
| `subscribe` / `isOnline` / `idle` / `dispose` | Change notifications, connection, pending background work, stop listening to events.  |

## Behaviour

- **The data key.** It is the non-extractable `CryptoKey` from the key chain. It stays in memory
  once unlocked and is remembered on the device by the core's IndexedDB store for 30 days from
  the last password entry, so opening the app unlocks it without the password.
- **Saving never loses a link.** `save` stores the link first, queued when there is no connection
  or the server fails for a while, and only then asks the proxy for the page. Reading happens on
  the device (`readExtract`): a page the proxy cannot fetch for good (blocked site, timeout,
  unsupported type) is kept as the bare link and not asked again; a busy proxy or no connection
  leaves it unread for the next `refresh`, at most 15 links each time.
- **Changes in order.** A change rewrites the whole item, so `change` runs them one after
  another: a background read and a classification made meanwhile both survive.
- **A session closed by the server** (password changed on another device) clears only the
  session: the app goes back to the login with the email filled in, and the queue uploads after
  the next login of the same account. Signing in with another account wipes the local data
  first.
- **Pages already read.** The extension reads the open tab itself: `readHtml` turns its HTML into
  a `ReadResult` and `save(url, { read })` stores it with the link, with no call to the proxy.
- **Thumbnails.** When a page has an image (`preview.imageUrl`), the device asks the proxy for it
  (`POST /api/extract/image`, never the site that serves it), reduces it with `createImageBitmap`
  and a canvas, and stores the result encrypted inside the item (`thumbnail`). It is made in the
  same write as the read result, right away, because some covers (TikTok) are signed and expire
  in about two days.
  - **Size.** Longest side 320 px (240 px as a second step), WebP (JPEG where the browser cannot
    encode it), quality 0.7, 0.5, 0.3 until it is at most 12 KiB. If nothing gets under 12 KiB the
    smallest result is kept up to 24 KiB; above that the item has no thumbnail. The reason is the
    quota: an account holds 25 MiB over at most 5 000 records, and at 40 KiB each a few hundred
    items would use it. A photo at that size is typically 8 to 12 KiB.
  - **Failures never lose the item.** A corrupt image, a type that is not JPEG, PNG, WebP, GIF or
    AVIF (SVG is refused by the proxy and again here), a body over 5 MiB, a gone image or a failed
    decode leave the item saved with its preview and no thumbnail.
  - **At most two tries.** One when the link is read or saved, and one on a later sync; if that
    also fails the image address is removed from the preview (one write, it syncs to the other
    devices) and it is never asked for again. A missing connection, a rate limit or a failing
    proxy do not count as a try: the batch stops and the item is left for the next sync. The
    count of the first try lives in memory, so after a reload an item gets one more try at most.
  - **Quota.** If the account has no room for the thumbnail, the item is stored without it.
  - **Items saved before.** Each `refresh` adds the thumbnail to at most 10 items that have an
    image address and no thumbnail, newest first. Reads (15) and fills (10) use at most
    15 x 2 + 10 = 40 requests, under the proxy's 60 every 10 minutes per account.
  - **Where.** Only in a context with a DOM and image decoding (`makeThumbnail`, on by default
    next to `readPages`): the extension's background saves without thumbnail and the next sync of
    the popup or the PWA adds it. `makeThumbnail: null` turns them off.
  - `createThumbnailUrls()` turns the decrypted bytes into `blob:` URLs, once per image, and
    revokes them when the image changes, the item disappears (`keepOnly`) or the session ends
    (`clear`). Nothing is written to disk in the clear.
- **No DOM, no reading.** Where `DOMParser` is missing (the extension's background) links are
  saved without reading; a context with a DOM reads them on its next `refresh`.

## Tests

`@stash/client/testing` exports `FakeBackend` (accounts, records and the extraction proxy in
memory) and `FastKdfWorker`, which stands in for the Argon2id worker under jsdom.
