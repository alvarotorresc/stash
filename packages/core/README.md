# @stash/core

Domain model and client-side cryptography shared by the PWA and the extension. Everything is
plain TypeScript; the apps import it from source through the workspace.

## Cryptography

All encryption happens on the device. The server stores salts, parameters, hashes of the keys
it receives and wrapped keys, never anything it can decrypt.

### Key chain

- **Password** → Argon2id (salt bound to the email) → HKDF → **login key** (sent to the
  server) and **password KEK**.
- **Recovery code** (128 random bits, shown once) → HKDF → **recovery auth key** (sent) and
  **recovery KEK**.
- **Data key**: 256 random bits, non-extractable, wrapped with AES-256-GCM by each KEK.
- **Records**: AES-256-GCM with a random nonce; the record id is bound to each blob.

Changing the password or recovering the account re-wraps the data key. No data is
re-encrypted, and the data key never changes, so a password change is not a revocation.

### API

| Function                                                                                                       | Use                                                                                             |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `createAccountKeys({ email, password })`                                                                       | Registration. Returns what the server stores, the recovery code to show once and the data key.  |
| `derivePasswordCredentials({ email, password, salt, kdf })`                                                    | Login. Returns single-use credentials: `loginKey` to send and `unlockDataKey(wrappedDataKey)`.  |
| `credentials.unlockDataKey(wrappedDataKey)`                                                                    | Returns `{ dataKey, upgrade }`. Send `upgrade` to the server when it is not `null` (see below). |
| `changePassword({ email, currentPassword, newPassword, salt, kdf, wrappedDataKey })`                           | Returns `currentLoginKey` (to authorise the change), the new password setup and the data key.   |
| `deriveRecoveryCredentials(code)` / `recoverAccount(recovery, { email, recoveryWrappedDataKey, newPassword })` | Recovery in two steps. Sets a new password and issues a new recovery code.                      |
| `encryptRecord(dataKey, recordId, bytes)` / `decryptRecord(dataKey, recordId, blob)`                           | Record blobs.                                                                                   |
| `createIndexedDbDataKeyStore()`                                                                                | Remembers the data key on the device for 30 days.                                               |
| `checkPassword(password)`                                                                                      | Pure check for the password field: `{ length, lengthOk, common }`.                              |

Errors are `CryptoError` with a `code`: `CREDENTIALS_USED`, `DECRYPTION_FAILED`,
`INVALID_INPUT`, `INVALID_KDF_PARAMS`, `INVALID_RECOVERY_CODE`, `KDF_FAILED` and
`PASSWORD_TOO_SHORT`.

### Passwords

- New passwords (registration, change and recovery) need at least `MIN_PASSWORD_LENGTH` (10)
  characters, counted as Unicode code points after NFC. Core throws `PASSWORD_TOO_SHORT`
  otherwise. The password typed at login is not checked, so the rule can change without
  locking anyone out.
- There are no case or symbol rules. The UI uses `checkPassword` for its strength meter and
  blocks passwords flagged as `common` (a small embedded list of very common passwords).
- The server receives the login key on every login and knows the salt and parameters, so a
  compromised server can always try to guess a password offline at the cost of Argon2id. A
  long, uncommon password is what keeps the data safe.

### Argon2id

- **Disposable worker.** Argon2id runs in a dedicated module Web Worker, one per derivation,
  which also does the HKDF split and returns only the login key and a non-extractable KEK. The
  worker is terminated right after it answers: libsodium frees its WebAssembly buffers without
  wiping them, and terminating the worker drops that memory. There is no fallback to the page
  thread: where Web Workers are missing (such as an extension's background service worker) the
  derivation fails with `KDF_FAILED`. Run it from a page or the popup.
- **CSP.** The worker is bundled by Vite as a separate same-origin file, and libsodium
  instantiates its WebAssembly from bytes, so `script-src 'self' 'wasm-unsafe-eval'` is enough.
- **Parameters.** New passwords use `DEFAULT_KDF_PARAMS` (m = 64 MiB, t = 3, p = 1). Parameters
  from the server must be between a floor (m = 64 MiB, t = 3), set independently of the
  defaults and never below the OWASP minimum, and a ceiling (m = 256 MiB, t = 10) that keeps a
  hostile server from making a phone hang.
- **Upgrades.** When an account logs in with parameters below the current defaults,
  `unlockDataKey` also returns `upgrade`: the same password under a new salt and the defaults,
  with the data key re-wrapped. Send it to the server in the session that just logged in. The
  server cannot tell an upgrade from a password change, so it closes the account's other
  sessions as a change does: raising the defaults logs every other device out once.
- **Salt bound to the email.** The Argon2id salt is
  `SHA-256("stash/v1/argon2id-salt" ‖ u32be(len(email)) ‖ email ‖ serverSalt)[0..16]`, with the
  email trimmed, NFC-normalised and lowercased. A server cannot make several accounts share a
  salt. Changing an account's email therefore requires re-deriving its password keys.

### Credentials

Password and recovery credentials are single use: `unlockDataKey` and `recoverAccount` consume
them and a second call throws `CREDENTIALS_USED`. Do not keep them in long-lived state.
`changePassword` takes the current password, not credentials, so nothing left over from a login
can re-wrap the data key under a password someone else chooses. The account client changes the
password in two steps with the same guarantee: the current password's keys give
`currentLoginKey`, which the server must accept before it hands out the wrapped data key, and the
single-use handle then re-wraps it.

### Remembered data key

`createIndexedDbDataKeyStore()` stores the non-extractable `CryptoKey` in IndexedDB.

- **Not encrypted at rest.** "Non-extractable" means JavaScript cannot read the key bytes. It
  is not disk encryption: the browser serialises the key material into its profile so it can
  restore it, and anyone with access to the files (malware, a copy of the profile, forensics on
  a rooted phone) may recover it. Protection on disk depends on the browser and on the device's
  own encryption. Deleting from IndexedDB does not guarantee the bytes are gone from disk.
- **30 days from the password.** `save(key, { afterPasswordEntry: true })` starts a 30-day
  window and must only be called right after the user typed the password (login, password
  change or recovery). `save(key, { afterPasswordEntry: false })` keeps the current window and
  is refused when there is none. Opening the app with the remembered key never extends it.
- **Fails closed.** `load()` returns the key only when the record is well formed and inside its
  window. An expired, corrupted or tampered record, or a clock set back before the save, counts
  as expired and is deleted as soon as it is read.

### Known limits

- The server can serve an older version of a record, hide records or return a deleted one: the
  blob is bound to its record id, not to a version.
- Blob size reveals the exact plaintext size (a fixed 29-byte overhead).

## Accounts

`createAccountClient({ dataKeyStore, sessionStore, onLogout, baseUrl?, fetch? })` combines the
key chain with the account API. It never stores or sends the password.

| Method                                             | What it does                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `register({ email, password })`                    | Creates the account and logs in. Returns the recovery code to show once.                          |
| `login({ email, password })`                       | Two steps: salt and parameters, then the login key. Sends the Argon2id upgrade when there is one. |
| `logout()`                                         | Closes the session on the server when it can, then always clears the data key, session and cache. |
| `changePassword({ currentPassword, newPassword })` | Proves the current password to get the wrapped data key, re-wraps it; other sessions are closed.  |
| `recover({ email, recoveryCode, newPassword })`    | Sets a new password and recovery code; the server closes every session.                           |
| `deleteAccount({ password })`                      | Proves the password, deletes the account and clears everything local, also on `UNAUTHORIZED`.     |
| `getSession()`                                     | The stored session, or `null` when there is none or it expired.                                   |

- Every password entry saves the data key with `afterPasswordEntry: true`.
- `onLogout` runs after logout and account deletion so the local record cache can wipe itself.
- Sessions live in a `SessionStore`: `createMemorySessionStore()`, or
  `createWebStorageSessionStore(localStorage)`. A script running on the origin can read the token
  in Web Storage, just as it can use the remembered data key, and use it from anywhere until it
  expires (30 days) or the user logs out, which deletes it on the server. The email is kept in
  clear next to it. IndexedDB would not change that. The defence is not letting foreign script
  run, which the app must treat as a requirement:
  - a strict CSP with no `unsafe-inline` or `unsafe-eval`: `script-src 'self' 'wasm-unsafe-eval'`
    (see CSP above), `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`;
  - no HTML from saved pages rendered unsanitised: extracted content goes through a sanitiser
    (Trusted Types where available) and never into `innerHTML` as is.

  Where keeping the session across reloads is not worth the risk, `createMemorySessionStore()` is
  the drop-in alternative: nothing is persisted and the user logs in on every visit.

- Failures are `AccountApiError` with the server's `code` (`INVALID_CREDENTIALS`,
  `RATE_LIMITED` with `retryAfter`, `UNAUTHORIZED`...), `NETWORK_ERROR` or `BAD_RESPONSE`.
- The wire contract is exported without any cryptography from `@stash/core/protocol`, which is
  what the Worker imports.

## Sync

`createSyncClient({ getToken, getDataKey, cache?, isOnline?, baseUrl?, fetch? })` from
`@stash/core/sync` keeps the account's items, categories and tags in step with the server. It
holds the decrypted copy in memory only; on disk there is the encrypted cache, and on the server
only encrypted blobs with their id, kind and version.

- `getToken` is `async () => (await accountClient.getSession())?.token ?? null`; `getDataKey` is
  `() => dataKeyStore.load()`.
- Each record is sealed with `encryptRecord(dataKey, id, plaintext)`: the blob is bound to its
  random id, never derived from the content. The thumbnail travels inside the item's blob.
- The cache (`createIndexedDbRecordCache({ indexedDB?, databaseName? })`) stores the blobs as the
  server sent them, plus the offline queue and the pull cursor. Nothing readable reaches
  IndexedDB. Pass `indexedDB` from `fake-indexeddb` in tests.
- Wire it to the account: `createAccountClient({ ..., onLogout: () => sync.clear() })`. Logout
  and account deletion then wipe memory, cache and queue.

### Online with cache

| Situation                         | Behaviour                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------- |
| No connection, reading            | `open()` loads the cache; lists and search work as usual.                                       |
| No connection, saving a new link  | It goes to the encrypted queue and shows with `queued: true`. `sync()` uploads it once.         |
| No connection, any other change   | Fails with `SyncError` code `OFFLINE`; nothing is queued.                                       |
| Two devices change the same thing | The server keeps the last write it receives; every device ends up with it on its next `sync()`. |

`sync()` uploads the queue, then pulls every change after the cursor, page by page, deletions
included. Calls overlap safely: a running sync or upload is shared, so a queued save is never sent
twice, and retrying one whose answer was lost does not duplicate it (`create` is idempotent by
id).

### API

| Method                                                   | What it does                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `open()` / `sync()`                                      | Load the cache (works offline) / upload the queue and pull changes.           |
| `listItems()` / `getItem(id)`                            | Items newest first, with category and tags resolved, as `ItemView`.           |
| `search({ query?, status?, source?, categoryId?, ... })` | Local search over title, URL, preview, tags and read content, plus filters.   |
| `saveLink({ url, preview?, content?, tags?, ... })`      | Saves a link, pending and unclassified unless told otherwise; queued offline. |
| `setReadResult(id, { preview, content, thumbnail? })`    | Stores what reading the link produced.                                        |
| `classify(id, { categoryId?, priority?, tags? })`        | Sets category, priority (`high`, `medium`, `low` or `null`) and tags by name. |
| `setStatus(id, status)`                                  | Marks `read`, `discarded` or `pending`; returns an undo.                      |
| `deleteItem(id)`                                         | Deletes the item; returns an undo that brings it back.                        |
| `listCategories()` / `createCategory(name)`              | Categories in order of importance, with item counts / adds one at the end.    |
| `renameCategory(id, name)` / `deleteCategory(id)`        | Renames / deletes; its items stay, without category.                          |
| `reorderCategories(ids)`                                 | New order: every category id once, most important first.                      |
| `listTags()` / `renameTag(id, name)` / `deleteTag(id)`   | Tags by use; renaming onto an existing name merges both; deleting unlinks it. |
| `pendingUploads()` / `subscribe(listener)` / `clear()`   | Queue size / change notifications / forget everything local.                  |

- An item is still to classify while it lacks a priority or a category: `isUnclassified(item)`, or
  `search({ unclassified: true })`. `categoryId: null` filters items without category.
- Tag names match ignoring case; category and tag names are trimmed, with length limits.
- Undo is another change: it needs the network too.
- Failures are `SyncError` with `code`: `OFFLINE`, `LOCKED` (no session or data key),
  `UNAUTHORIZED`, `NOT_FOUND`, `INVALID_INPUT`, `TOO_LARGE`, `QUOTA_EXCEEDED`, `RATE_LIMITED`
  (with `retryAfter`), `CONFLICT`, `BAD_RESPONSE` or `SERVER_ERROR`.
- An item too big for the server's blob limit is shrunk before saving: first the read content's
  HTML goes, then its text is cut, and only then the thumbnail goes.
- A record that does not decrypt is skipped; a cached one that no longer decrypts is dropped and
  pulled again.

### Records API

The wire contract is exported without cryptography from `@stash/core/sync-protocol`.

- `POST /api/records` with `{ operations: [...] }` (at most 100, 4 MB body): `create` stores a new
  id and is a no-op on retry; `put` overwrites (last write wins, also undoes a delete); `delete`
  leaves a tombstone. Answers `{ data: { results: [{ id, applied, version }] } }` in order.
- `GET /api/records?cursor=<n>&limit=<n>` answers `{ data: WireRecord[], meta: { nextCursor,
hasMore } }` in version order. Cursor `0` is the first load and leaves tombstones out.
- Versions are assigned by the server, increasing per account. Limits: 1 MiB per blob, 20 000
  records and 50 MiB per account. Both need a Bearer session and share a per-account rate limit.
