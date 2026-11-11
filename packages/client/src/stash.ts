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
} from '@stash/core/sync';
import { ExtractError, createExtractor, type Extractor } from './extract';
import { readExtract, unreadableLink } from './read';

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
   * already saved creates nothing: the existing item comes back with `alreadySaved: true` and its
   * page is read again in the background (the given `read`, or the proxy), which refreshes its
   * preview and content but not its category, priority, tags or status. The new read counts
   * against the extraction limit and as one edit, like any other. Offline, or while the item
   * still waits in the queue, nothing is read: the refresh is not queued.
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

/** Background reads per refresh, well under the proxy's limit of 60 every 10 minutes. */
const MAX_READS_PER_REFRESH = 20;

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/** Whether a read found anything to show: a bare link has no title, description or text. */
function readSomething({ preview, content }: ReadResult): boolean {
  return !!(preview?.title || preview?.description || content?.text);
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
      await sync.clear();
    },
  });

  const extract: Extractor = createExtractor({ baseUrl, fetch: fetchFn });

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
   * Reads one link through the proxy and stores the result. Failures leave it for later. With
   * `again` the link is read although it already has a preview: whatever it had stays when the
   * new read fails or finds nothing.
   */
  async function readItem(id: string, again = false): Promise<void> {
    if (!readPages || reading.has(id)) return;
    const item = sync.getItem(id);
    const token = (await account.getSession())?.token;
    if (item === null || item.queued || (item.preview !== null && !again) || !token) return;
    reading.add(id);
    try {
      let result;
      try {
        result = readExtract(await extract(token, item.url), item.url);
      } catch (error) {
        if (again || !(error instanceof ExtractError) || !error.permanent) return;
        result = unreadableLink(item.url);
      }
      if (again && !readSomething(result)) return;
      await change((client) => client.setReadResult(id, result));
    } catch {
      // Offline, deleted meanwhile or the server failed: the link stays saved and unread.
    } finally {
      reading.delete(id);
    }
  }

  /** Reads a link that was saved again (see `Stash.save`). Failures leave it as it was. */
  async function refreshSaved(id: string, read: ReadResult | undefined): Promise<void> {
    if (read === undefined) return readItem(id, true);
    try {
      await change((client) => client.setReadResult(id, read));
    } catch {
      // Offline or deleted meanwhile: the item keeps what it had.
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
    try {
      await guard(() => sync.sync());
    } catch {
      // Offline or the server failed: the cache still shows everything.
    }
    await readUnread();
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
      if (!item.queued && !read && !item.alreadySaved) void track(readItem(item.id));
      if (item.alreadySaved && !item.queued && isOnline()) void track(refreshSaved(item.id, read));
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
