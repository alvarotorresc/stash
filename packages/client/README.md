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

| Method                                        | What it does                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `session()`                                   | The session when the data key is unlocked too; `null` means "ask for the password".  |
| `lastEmail()`                                 | The email of the last session on the device, also once expired.                      |
| `register` / `login` / `recover`              | Password entries. `register` and `recover` return a recovery code to show once.      |
| `changePassword` / `logout` / `deleteAccount` | Logout and deletion forget the data key, the cache and the queue.                    |
| `start()` / `refresh()`                       | Load the cache (offline too) / upload the queue, pull and read unread links.         |
| `save(url)`                                   | Saves at once and reads the page in the background.                                  |
| `change(run)`                                 | Runs a change through the sync client, one at a time.                                |
| `subscribe` / `isOnline` / `idle` / `dispose` | Change notifications, connection, pending background work, stop listening to events. |

## Behaviour

- **The data key.** It is the non-extractable `CryptoKey` from the key chain. It stays in memory
  once unlocked and is remembered on the device by the core's IndexedDB store for 30 days from
  the last password entry, so opening the app unlocks it without the password.
- **Saving never loses a link.** `save` stores the link first, queued when there is no connection
  or the server fails for a while, and only then asks the proxy for the page. Reading happens on
  the device (`readExtract`): a page the proxy cannot fetch for good (blocked site, timeout,
  unsupported type) is kept as the bare link and not asked again; a busy proxy or no connection
  leaves it unread for the next `refresh`, at most 20 links each time.
- **Changes in order.** A change rewrites the whole item, so `change` runs them one after
  another: a background read and a classification made meanwhile both survive.
- **A session closed by the server** (password changed on another device) clears only the
  session: the app goes back to the login with the email filled in, and the queue uploads after
  the next login of the same account. Signing in with another account wipes the local data
  first.
- **No DOM, no reading.** Where `DOMParser` is missing (the extension's background) links are
  saved without reading; a context with a DOM reads them on its next `refresh`.

## Tests

`@stash/client/testing` exports `FakeBackend` (accounts, records and the extraction proxy in
memory) and `FastKdfWorker`, which stands in for the Argon2id worker under jsdom.
