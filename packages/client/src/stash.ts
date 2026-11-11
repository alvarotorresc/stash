import {
  createAccountClient,
  createIndexedDbDataKeyStore,
  createMemorySessionStore,
  type AccountClient,
  type DataKey,
  type DataKeyStore,
  type SessionStore,
} from '@stash/core';
import { normalizeEmail } from '@stash/core/protocol';
import {
  SyncError,
  createIndexedDbRecordCache,
  createSyncClient,
  type ReadResult,
  type RecordCache,
  type SavedLink,
  type SyncClient,
  type Thumbnail,
} from '@stash/core/sync';
import {
  ExtractError,
  createExtractor,
  createImageFetcher,
  type Extractor,
  type ImageFetcher,
} from './extract';
import { readExtract, unreadableLink } from './read';
import {
  browserThumbnailsSupported,
  createBrowserThumbnailCodec,
  createThumbnailMaker,
  type ThumbnailMaker,
} from './thumbnail';

export interface StashOptions {
  /** Origin of the API; empty for the same origin (the Worker serves the app). */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
  /** Where the session lives. Defaults to memory: nothing survives a reload. */
  readonly sessionStore?: SessionStore;
  /** Defaults to IndexedDB, which remembers the data key for 30 days. */
  readonly dataKeyStore?: DataKeyStore;
  /** Defaults to the encrypted IndexedDB cache. */
  readonly cache?: RecordCache;
  /** Defaults to `navigator.onLine`. */
  readonly isOnline?: () => boolean;
  /**
   * Whether this context reads pages (the reader needs a DOM). Without it, links are saved and
   * another context reads them later. Defaults to whether `DOMParser` exists.
   */
  readonly readPages?: boolean;
  /**
   * Reduces a downloaded preview image to the thumbnail kept with the item. It needs image
   * decoding, so by default it exists only where pages are read and the browser can decode and
   * draw (the PWA and the popup): the background of the extension saves links without thumbnail
   * and a context with a DOM adds it on a later sync. `null` turns thumbnails off.
   */
  readonly makeThumbnail?: ThumbnailMaker | null;
  /** Where the connection events come from; defaults to `window` when there is one. */
  readonly events?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  readonly now?: () => number;
}

/** A session this device can use: logged in and with the data key unlocked. */
export interface UnlockedSession {
  readonly email: string;
  /** When the device stops remembering it (milliseconds since the epoch). */
  readonly expiresAt: number;
}

export interface SaveOptions {
  /**
   * The page was already read here (the extension reads the open tab): it is stored with the
   * link and the proxy is not asked for it.
   */
  readonly read?: ReadResult;
}

export interface Stash {
  /** Reads (lists, search, item) go straight to the sync client; changes go through `change`. */
  readonly sync: SyncClient;

  /** The session, only when the data key is unlocked too; null means "ask for the password". */
  session(): Promise<UnlockedSession | null>;
  /** Email of the last session on this device, also once it expired, to unlock faster. */
  lastEmail(): Promise<string | null>;

  /** Creates the account and logs in. Show the recovery code once. */
  register(input: { email: string; password: string }): Promise<{ recoveryCode: string }>;
  login(input: { email: string; password: string }): Promise<void>;
  /** Sets a new password with the recovery code. The old code stops working: show the new one. */
  recover(input: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }): Promise<{ recoveryCode: string }>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  /** Closes the session and forgets everything local: data key, cache and queue. */
  logout(): Promise<void>;
  deleteAccount(input: { password: string }): Promise<void>;

  /**
   * Loads the local cache (works offline), then syncs and reads pending links in the background.
   * Once per unlocked session: calling it again returns the same start.
   */
  start(): Promise<void>;
  /** Uploads the queue, pulls changes and reads links still unread. Never throws. */
  refresh(): Promise<void>;
  /**
   * Saves a link at once (queued without connection or when the server fails) and reads it in
   * the background: the save never waits for the page and is never lost because of it. A link
   * already saved creates nothing and is not read again: the existing item comes back with
   * `alreadySaved: true`.
   */
  save(url: string, options?: SaveOptions): Promise<SavedLink>;
  /**
   * Runs a change through the sync client, one at a time: each change starts from the copy the
   * previous one left, so a background read and a classification never overwrite each other.
   */
  change<T>(run: (sync: SyncClient) => Promise<T>): Promise<T>;
  /** Background reads still running, for tests and for a clean shutdown. */
  idle(): Promise<void>;

  isOnline(): boolean;
  /** Called after any change: data, session or connection. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Stops listening to connection events. */
  dispose(): void;
}

/**
 * Background reads per refresh. Images share the proxy's limit of 60 requests every 10 minutes
 * per account: a read makes up to two requests (page and image) and the backfill one each, so a
 * refresh makes at most 15 x 2 + 10 = 40.
 */
const MAX_READS_PER_REFRESH = 15;
/** Thumbnails added to items saved before this feature, per refresh. */
const MAX_THUMBNAIL_FILLS_PER_REFRESH = 10;

type BuiltThumbnail =
  | { readonly state: 'ok'; readonly thumbnail: Thumbnail }
  /** The image is unusable (gone, corrupt, too large, not allowed): asking again will not help. */
  | { readonly state: 'failed' }
  /** Offline, rate limited or the server failed: nothing was learned about the image. */
  | { readonly state: 'transient' };

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function isSyncError(error: unknown, code: SyncError['code']): boolean {
  return error instanceof SyncError && error.code === code;
}

export function createStash(options: StashOptions = {}): Stash {
  const {
    baseUrl = '',
    fetch: fetchFn,
    sessionStore = createMemorySessionStore(),
    dataKeyStore = createIndexedDbDataKeyStore(),
    isOnline = defaultIsOnline,
    readPages = typeof DOMParser !== 'undefined',
    now,
  } = options;
  const events = options.events === undefined ? globalThis.window : options.events;

  const listeners = new Set<() => void>();
  // The unlocked data key, kept in memory once read: it is a non-extractable CryptoKey.
  let dataKey: DataKey | null = null;
  let opened: Promise<void> | null = null;
  /** The running session's start: once per unlock, so a reload of the screens never repeats it. */
  let started: Promise<void> | null = null;
  const reading = new Set<string>();
  const background = new Set<Promise<unknown>>();
  let writes: Promise<unknown> = Promise.resolve();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  async function getDataKey(): Promise<DataKey | null> {
    if (dataKey === null) dataKey = await dataKeyStore.load();
    return dataKey;
  }

  const sync = createSyncClient({
    baseUrl,
    fetch: fetchFn,
    cache: options.cache ?? createIndexedDbRecordCache(),
    isOnline,
    now,
    getToken: async () => (await account.getSession())?.token ?? null,
    getDataKey,
  });

  const account: AccountClient = createAccountClient({
    baseUrl,
    fetch: fetchFn,
    dataKeyStore,
    sessionStore,
    now,
    onLogout: async () => {
      dataKey = null;
      opened = null;
      started = null;
      attempted.clear();
      await sync.clear();
    },
  });

  const extract: Extractor = createExtractor({ baseUrl, fetch: fetchFn });
  const fetchImage: ImageFetcher = createImageFetcher({ baseUrl, fetch: fetchFn });
  const makeThumbnail: ThumbnailMaker | null =
    options.makeThumbnail !== undefined
      ? options.makeThumbnail
      : readPages && browserThumbnailsSupported()
        ? createThumbnailMaker(createBrowserThumbnailCodec())
        : null;
  /** Counts refreshes, so an item tried while saving is tried again on a later one, not at once. */
  let round = 0;
  /** Items whose thumbnail failed, with the refresh they failed in (in memory, per session). */
  const attempted = new Map<string, number>();

  sync.subscribe(notify);

  /**
   * The server closed this session (password changed or account upgraded on another device).
   * Only the session goes: the queue stays for the next login of the same account. The email
   * is kept, as an expired session, so the login screen can fill it in.
   */
  async function endSession(): Promise<void> {
    const stored = await sessionStore.load();
    if (stored === null) return;
    await sessionStore.save({ ...stored, token: '', expiresAt: 0 });
    started = null;
    notify();
  }

  async function guard<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (isSyncError(error, 'UNAUTHORIZED')) await endSession();
      throw error;
    }
  }

  function track<T>(promise: Promise<T>): Promise<T> {
    background.add(promise);
    void promise.finally(() => background.delete(promise)).catch(() => {});
    return promise;
  }

  function change<T>(run: (client: SyncClient) => Promise<T>): Promise<T> {
    const next = writes.then(() => guard(() => run(sync)));
    writes = next.catch(() => {});
    return next;
  }

  /**
   * Downloads the preview image through the proxy and reduces it on the device. It never throws:
   * whatever goes wrong the item stays as it is, without thumbnail.
   */
  async function buildThumbnail(
    token: string,
    imageUrl: string,
    make: ThumbnailMaker,
  ): Promise<BuiltThumbnail> {
    try {
      const thumbnail = await make(await fetchImage(token, imageUrl));
      return thumbnail ? { state: 'ok', thumbnail } : { state: 'failed' };
    } catch (error) {
      return error instanceof ExtractError && !error.permanent
        ? { state: 'transient' }
        : { state: 'failed' };
    }
  }

  /**
   * Stores a read result. If the account has no room for the thumbnail the item is stored
   * without it, and without the image address so it is not tried again: the item is never lost.
   */
  async function storeResult(id: string, result: ReadResult): Promise<void> {
    try {
      await change((client) => client.setReadResult(id, result));
    } catch (error) {
      const full = isSyncError(error, 'QUOTA_EXCEEDED') || isSyncError(error, 'TOO_LARGE');
      if (!result.thumbnail || !full) throw error;
      const { preview, content, source } = result;
      await change((client) =>
        client.setReadResult(id, {
          ...(source && { source }),
          preview: preview && { ...preview, imageUrl: null },
          content,
        }),
      );
    }
  }

  /** Reads one link through the proxy and stores the result. Failures leave it for later. */
  async function readItem(id: string): Promise<void> {
    if (!readPages || reading.has(id)) return;
    const item = sync.getItem(id);
    const token = (await account.getSession())?.token;
    if (item === null || item.queued || item.preview !== null || !token) return;
    reading.add(id);
    try {
      let result: ReadResult;
      try {
        result = readExtract(await extract(token, item.url), item.url);
      } catch (error) {
        if (!(error instanceof ExtractError) || !error.permanent) return;
        result = unreadableLink(item.url);
      }
      // Right away: some covers (TikTok) are signed and stop working in about two days.
      const imageUrl = result.preview?.imageUrl;
      if (makeThumbnail && imageUrl) {
        const built = await buildThumbnail(token, imageUrl, makeThumbnail);
        if (built.state === 'ok') result = { ...result, thumbnail: built.thumbnail };
        else if (built.state === 'failed') attempted.set(id, round);
      }
      await storeResult(id, result);
    } catch {
      // Offline, deleted meanwhile or the server failed: the link stays saved and unread.
    } finally {
      reading.delete(id);
    }
  }

  /**
   * Adds the thumbnail to an item that has its preview but no thumbnail. `final` is the last
   * try: if the image fails again its address is dropped (one write, also for the other
   * devices) so it is never asked for again. Returns `stop` when the network or the proxy is
   * unavailable, so a batch does not keep knocking.
   */
  async function fillThumbnail(id: string, final: boolean): Promise<'done' | 'stop'> {
    if (!makeThumbnail || reading.has(id)) return 'done';
    const item = sync.getItem(id);
    const token = (await account.getSession())?.token;
    const preview = item?.preview;
    const imageUrl = preview?.imageUrl;
    if (!item || !preview || !token || item.queued || item.thumbnail !== null || !imageUrl) {
      return 'done';
    }
    reading.add(id);
    try {
      const built = await buildThumbnail(token, imageUrl, makeThumbnail);
      if (built.state === 'transient') return 'stop';
      const { content } = item;
      if (built.state === 'ok') {
        await storeResult(id, { preview, content, thumbnail: built.thumbnail });
      } else if (final) {
        await storeResult(id, { preview: { ...preview, imageUrl: null }, content });
      } else {
        attempted.set(id, round);
      }
      return 'done';
    } catch {
      return 'stop';
    } finally {
      reading.delete(id);
    }
  }

  /** Thumbnails for items saved without one, a few per refresh and each tried at most twice. */
  async function backfillThumbnails(): Promise<void> {
    if (!makeThumbnail || !isOnline()) return;
    const missing = sync
      .listItems()
      .filter(
        (item) =>
          !item.queued &&
          item.thumbnail === null &&
          !!item.preview?.imageUrl &&
          attempted.get(item.id) !== round,
      )
      .slice(0, MAX_THUMBNAIL_FILLS_PER_REFRESH);
    for (const item of missing) {
      if ((await fillThumbnail(item.id, true)) === 'stop') return;
    }
  }

  async function readUnread(): Promise<void> {
    const unread = sync
      .listItems()
      .filter((item) => !item.queued && item.preview === null)
      .slice(0, MAX_READS_PER_REFRESH);
    for (const item of unread) await readItem(item.id);
  }

  async function refresh(): Promise<void> {
    if (!(await session())) return;
    round += 1;
    try {
      await guard(() => sync.sync());
    } catch {
      // Offline or the server failed: the cache still shows everything.
    }
    await readUnread();
    await backfillThumbnails();
  }

  function open(): Promise<void> {
    if (opened === null) {
      opened = sync.open();
      opened.catch(() => {
        opened = null;
      });
    }
    return opened;
  }

  function start(): Promise<void> {
    if (started === null) {
      started = open().then(() => {
        void track(refresh());
      });
      started.catch(() => {
        started = null;
      });
    }
    return started;
  }

  async function session(): Promise<UnlockedSession | null> {
    const stored = await account.getSession();
    if (stored === null || (await getDataKey()) === null) return null;
    return { email: stored.email, expiresAt: stored.expiresAt };
  }

  async function lastEmail(): Promise<string | null> {
    return (await sessionStore.load())?.email ?? null;
  }

  /**
   * Before a password entry opens a session: data of another account left by a closed session
   * must not show under the new one, so it is wiped. The same account keeps its queue.
   */
  async function beforeSignIn(email: string): Promise<void> {
    const previous = await lastEmail();
    if (previous !== null && normalizeEmail(previous) !== normalizeEmail(email)) {
      opened = null;
      await sync.clear();
    }
    started = null;
  }

  async function afterSignIn(key: DataKey): Promise<void> {
    dataKey = key;
    notify();
    await start();
  }

  function onConnection(): void {
    notify();
    if (isOnline()) void track(refresh());
  }

  events?.addEventListener('online', onConnection);
  events?.addEventListener('offline', notify);

  return {
    sync,
    session,
    lastEmail,

    async register(input) {
      await beforeSignIn(input.email);
      const { recoveryCode, dataKey: key } = await account.register(input);
      await afterSignIn(key);
      return { recoveryCode };
    },

    async login(input) {
      await beforeSignIn(input.email);
      const { dataKey: key } = await account.login(input);
      await afterSignIn(key);
    },

    async recover(input) {
      await beforeSignIn(input.email);
      const { recoveryCode, dataKey: key } = await account.recover(input);
      await afterSignIn(key);
      return { recoveryCode };
    },

    async changePassword(input) {
      const { dataKey: key } = await account.changePassword(input);
      dataKey = key;
      notify();
    },

    async logout() {
      await account.logout();
      notify();
    },

    async deleteAccount(input) {
      try {
        await account.deleteAccount(input);
      } finally {
        if ((await account.getSession()) === null) notify();
      }
    },

    start,
    refresh,

    async save(url, { read } = {}) {
      await open();
      const item = await guard(() => sync.saveLink(read ? { url, ...read } : { url }));
      if (!item.queued && !item.alreadySaved) {
        // Already read (the extension read the tab): only the image is missing.
        if (!read) void track(readItem(item.id));
        else if (item.preview?.imageUrl) void track(fillThumbnail(item.id, false));
      }
      return item;
    },

    change,

    async idle() {
      while (background.size > 0) await Promise.allSettled([...background]);
      await writes;
    },

    isOnline,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    dispose() {
      events?.removeEventListener('online', onConnection);
      events?.removeEventListener('offline', notify);
    },
  };
}
