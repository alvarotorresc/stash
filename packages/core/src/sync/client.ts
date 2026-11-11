/**
 * Sync client: the decrypted copy of the account's records in memory, the encrypted local cache
 * and the offline queue, kept in step with the server.
 *
 * Online with cache: without connection the app reads the cache and can save new links, which
 * wait in the queue and upload once when the connection is back. Every other change (classify,
 * mark, rename, delete...) needs the network and fails with `OFFLINE` without it. Conflicts are
 * resolved by the server: the last write wins.
 */
import { fromBase64Url, toBase64Url } from '../crypto/encoding';
import type { DataKey } from '../crypto/records';
import { isPriority, type Priority } from '../priority';
import { createIndexedDbRecordCache, type CachedRecord, type RecordCache } from './cache';
import { fitItem, openRecord, sealRecord } from './codec';
import { SyncError, type SyncErrorCode } from './errors';
import {
  categoryName,
  detectSource,
  httpUrl,
  itemTitle,
  tagKey,
  tagName,
  type Category,
  type Item,
  type ItemContent,
  type ItemPreview,
  type ItemStatus,
  type RecordValue,
  type Source,
  type Tag,
  type Thumbnail,
} from './model';
import {
  MAX_PUSH_BODY_BYTES,
  MAX_PUSH_RECORDS,
  type PushOperation,
  type RecordKind,
} from './protocol';
import { searchItems, type ItemFilters, type ItemView, type SearchResult } from './search';
import { createTransport, type Transport, type TransportOptions } from './transport';
import { urlKey } from './url-key';

export interface SyncClientOptions extends TransportOptions {
  /** The session's bearer token, or null when logged out (`accountClient.getSession()`). */
  readonly getToken: () => Promise<string | null>;
  /** The remembered data key, or null when locked (`dataKeyStore.load()`). */
  readonly getDataKey: () => Promise<DataKey | null>;
  /** Defaults to `createIndexedDbRecordCache()`. */
  readonly cache?: RecordCache;
  /** Defaults to `navigator.onLine`. */
  readonly isOnline?: () => boolean;
  readonly now?: () => number;
  /** Record ids; defaults to `crypto.randomUUID()`. Never derived from the content. */
  readonly newId?: () => string;
  /** Injectable for tests. */
  readonly transport?: Transport;
}

export interface SaveLinkInput {
  readonly url: string;
  /** Detected from the URL when missing. */
  readonly source?: Source;
  readonly preview?: ItemPreview | null;
  readonly content?: ItemContent | null;
  readonly thumbnail?: Thumbnail | null;
  readonly categoryId?: string | null;
  readonly priority?: Priority | null;
  /** Tag names; existing tags are reused ignoring case, new ones are created. */
  readonly tags?: readonly string[];
}

/** The item a save ended in; `alreadySaved` when that link was already in Stash and nothing was created. */
export type SavedLink = ItemView & { readonly alreadySaved: boolean };

export interface Classification {
  readonly categoryId?: string | null;
  readonly priority?: Priority | null;
  /** The item's full list of tag names. */
  readonly tags?: readonly string[];
}

/** What reading a link produced, to store once it has been extracted. */
export interface ReadResult {
  readonly source?: Source;
  /** Where the page really lives, when that is not the saved link (see `Item.canonicalUrl`). */
  readonly canonicalUrl?: string;
  readonly preview: ItemPreview | null;
  readonly content: ItemContent | null;
  readonly thumbnail?: Thumbnail | null;
}

export interface CategoryView extends Category {
  /** Items in this category. */
  readonly count: number;
}

export interface TagView extends Tag {
  /** Items that use the tag. */
  readonly count: number;
}

export interface SyncSummary {
  /** Queued records uploaded. */
  readonly uploaded: number;
  /** Records received from the server (changes and deletions). */
  readonly received: number;
  /** Records that could not be decrypted or read and were skipped. */
  readonly skipped: number;
}

/** Reverts a change; it needs the network like any other change. */
export type Undo = () => Promise<void>;

export interface SyncClient {
  /** Loads the local cache into memory. Works offline; call it before reading. */
  open(): Promise<void>;
  /** Uploads the queue, then pulls every change since the last cursor. One run at a time. */
  sync(): Promise<SyncSummary>;

  listItems(): ItemView[];
  getItem(id: string): ItemView | null;
  search(filters?: ItemFilters): SearchResult[];
  /**
   * Saves a link. Offline, or if the upload fails for lack of connection or a passing server
   * failure, it is queued: a save is never lost.
   *
   * A link that is already saved (also waiting in the queue, and whatever its status) creates
   * nothing: the existing item comes back with `alreadySaved: true`. Links are compared by
   * `urlKey`, against both its saved address and the canonical one a read found; a deleted item
   * no longer counts.
   */
  saveLink(input: SaveLinkInput): Promise<SavedLink>;
  /** Stores what reading the link produced (preview, content, thumbnail). */
  setReadResult(id: string, result: ReadResult): Promise<void>;
  classify(id: string, change: Classification): Promise<void>;
  /** Marks read, discarded or pending; the returned undo restores the previous status. */
  setStatus(id: string, status: ItemStatus): Promise<Undo>;
  /** Deletes the item; the returned undo brings it back. */
  deleteItem(id: string): Promise<Undo>;

  /** Categories in order of importance. */
  listCategories(): CategoryView[];
  createCategory(name: string): Promise<Category>;
  renameCategory(id: string, name: string): Promise<void>;
  /** Deletes the category; its items stay, unclassified. */
  deleteCategory(id: string): Promise<void>;
  /** New order of importance: every category id, most important first. */
  reorderCategories(ids: readonly string[]): Promise<void>;

  /** Tags, most used first. */
  listTags(): TagView[];
  /** Renames a tag; if another tag already has the name, the two are merged. */
  renameTag(id: string, name: string): Promise<void>;
  /** Deletes a tag and removes it from every item. */
  deleteTag(id: string): Promise<void>;

  /** Records saved offline that have not been uploaded yet. */
  pendingUploads(): number;
  /** Forgets everything local: memory, cache and queue. Hook it to the account's `onLogout`. */
  clear(): Promise<void>;
  /** Called after any change of the local data. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** Whether the item is the link with this `urlKey`, by its saved address or its canonical one. */
function sameLink(item: Item, key: string): boolean {
  return (
    urlKey(item.url) === key ||
    (item.canonicalUrl !== undefined && urlKey(item.canonicalUrl) === key)
  );
}

interface ValueOf {
  item: Item;
  category: Category;
  tag: Tag;
}

interface Entry {
  readonly record: RecordValue;
  /** Server version, or null while it only exists in the queue. */
  readonly version: number | null;
  readonly queued: boolean;
}

type Change =
  | { readonly op: 'create' | 'put'; readonly record: RecordValue }
  | { readonly op: 'delete'; readonly id: string; readonly kind: RecordKind };

interface SealedChange {
  readonly change: Change;
  readonly operation: PushOperation;
  readonly bytes: Uint8Array | null;
}

/** Room left in a push body for the JSON around the blobs. */
const PUSH_BODY_BUDGET = MAX_PUSH_BODY_BYTES - 64 * 1024;
const OPERATION_OVERHEAD = 128;

/** Splits operations into pushes the server accepts: by count and by body size. */
function chunk<T extends { operation: PushOperation }>(items: readonly T[]): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = ('blob' in item.operation ? item.operation.blob.length : 0) + OPERATION_OVERHEAD;
    if (
      current.length > 0 &&
      (current.length === MAX_PUSH_RECORDS || bytes + size > PUSH_BODY_BUDGET)
    ) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function offline(): SyncError {
  return new SyncError('OFFLINE', 'This change needs a connection');
}

/**
 * Failures after which a new save waits in the queue instead of being lost: no connection, or a
 * server that may accept it later (overloaded, rate limited, answering garbage, or a session that
 * was closed elsewhere and comes back with the next login). A save the server refuses for good
 * (quota, size, input) is not queued: retrying it would only fail again.
 */
const QUEUE_ON: ReadonlySet<SyncErrorCode> = new Set<SyncErrorCode>([
  'OFFLINE',
  'SERVER_ERROR',
  'RATE_LIMITED',
  'BAD_RESPONSE',
  'UNAUTHORIZED',
]);

function canQueueAfter(error: unknown): boolean {
  return error instanceof SyncError && QUEUE_ON.has(error.code);
}

function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export function createSyncClient(options: SyncClientOptions): SyncClient {
  const {
    getToken,
    getDataKey,
    cache = createIndexedDbRecordCache(),
    isOnline = defaultIsOnline,
    now = Date.now,
    newId = () => crypto.randomUUID(),
    transport = createTransport(options),
  } = options;

  const entries = new Map<string, Entry>();
  /** Encrypted create operations waiting for the connection, by record id. */
  const queue = new Map<string, { kind: RecordKind; blob: Uint8Array; queuedAt: number }>();
  const listeners = new Set<() => void>();
  let cursor = '0';
  /** Bumped by `clear`: work started before it must not write anything back. */
  let epoch = 0;
  let opened: Promise<void> | null = null;
  let syncing: Promise<SyncSummary> | null = null;
  let flushing: Promise<number> | null = null;
  let lastQueuedAt = 0;

  function notify(): void {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        console.error('sync: listener failed', error instanceof Error ? error.name : typeof error);
      }
    }
  }

  async function requireKey(): Promise<DataKey> {
    const key = await getDataKey();
    if (key === null) throw new SyncError('LOCKED', 'Log in to unlock your data');
    return key;
  }

  async function requireToken(): Promise<string> {
    const token = await getToken();
    if (token === null) throw new SyncError('LOCKED', 'Log in to sync');
    return token;
  }

  // Reading the decrypted copy.

  function valuesOf<K extends RecordKind>(kind: K): ValueOf[K][] {
    const values: ValueOf[K][] = [];
    for (const { record } of entries.values()) {
      if (record.kind === kind) values.push(record.value as ValueOf[K]);
    }
    return values;
  }

  function category(id: string | null): Category | null {
    const entry = id === null ? undefined : entries.get(id);
    return entry?.record.kind === 'category' ? entry.record.value : null;
  }

  function tag(id: string): Tag | null {
    const entry = entries.get(id);
    return entry?.record.kind === 'tag' ? entry.record.value : null;
  }

  function view(item: Item, queued: boolean): ItemView {
    const resolved = category(item.categoryId);
    const tags = item.tagIds.map(tag).filter((value): value is Tag => value !== null);
    return {
      ...item,
      categoryId: resolved?.id ?? null,
      tagIds: tags.map(({ id }) => id),
      title: itemTitle(item),
      category: resolved,
      tags,
      queued,
    };
  }

  function listItems(): ItemView[] {
    const items: ItemView[] = [];
    for (const { record, queued } of entries.values()) {
      if (record.kind === 'item') items.push(view(record.value, queued));
    }
    return items.sort((a, b) => b.savedAt - a.savedAt);
  }

  function requireEntry<K extends RecordKind>(
    id: string,
    kind: K,
  ): { value: ValueOf[K]; queued: boolean } {
    const entry = entries.get(id);
    if (entry === undefined || entry.record.kind !== kind) {
      throw new SyncError('NOT_FOUND', `No such ${kind}`);
    }
    return {
      value: entry.record.value as ValueOf[K],
      queued: entry.queued,
    };
  }

  /** Ids of the tags with these names, creating the missing ones (as records to create). */
  function resolveTags(names: readonly string[], at: number): { ids: string[]; created: Tag[] } {
    const byKey = new Map(valuesOf('tag').map((value) => [tagKey(value.name), value]));
    const ids: string[] = [];
    const created: Tag[] = [];
    for (const raw of names) {
      const name = tagName(raw);
      const key = tagKey(name);
      let found = byKey.get(key);
      if (found === undefined) {
        found = { id: newId(), name, createdAt: at };
        byKey.set(key, found);
        created.push(found);
      }
      if (!ids.includes(found.id)) ids.push(found.id);
    }
    return { ids, created };
  }

  // Loading the cache.

  async function load(): Promise<void> {
    const startedAt = epoch;
    const snapshot = await cache.load();
    const key = await requireKey();
    const loaded = new Map<string, Entry>();
    const broken: string[] = [];
    for (const { id, kind, version, blob } of snapshot.records) {
      try {
        loaded.set(id, { record: await openRecord(key, id, kind, blob), version, queued: false });
      } catch {
        broken.push(id);
      }
    }
    const queued: [string, { kind: RecordKind; blob: Uint8Array; queuedAt: number }][] = [];
    const brokenQueue: string[] = [];
    for (const { id, kind, blob, queuedAt } of snapshot.queue) {
      try {
        loaded.set(id, {
          record: await openRecord(key, id, kind, blob),
          version: null,
          queued: true,
        });
        queued.push([id, { kind, blob, queuedAt }]);
      } catch {
        brokenQueue.push(id);
      }
    }
    if (startedAt !== epoch) return;
    entries.clear();
    for (const [id, entry] of loaded) entries.set(id, entry);
    queue.clear();
    for (const [id, value] of queued) queue.set(id, value);
    lastQueuedAt = Math.max(0, ...queued.map(([, value]) => value.queuedAt));
    cursor = snapshot.cursor;
    if (broken.length > 0 || brokenQueue.length > 0) {
      // A record that no longer opens (another account's key, corruption): drop it and pull
      // everything again so the server's copy replaces it.
      if (broken.length > 0) cursor = '0';
      await cache.write({ remove: broken, dequeue: brokenQueue, cursor });
    }
    notify();
  }

  function open(): Promise<void> {
    if (opened === null) {
      opened = load();
      opened.catch(() => {
        opened = null;
      });
    }
    return opened;
  }

  // Talking to the server.

  async function seal(key: DataKey, change: Change): Promise<SealedChange> {
    if (change.op === 'delete') {
      return { change, operation: { op: 'delete', id: change.id, kind: change.kind }, bytes: null };
    }
    const bytes = await sealRecord(key, change.record);
    return {
      change,
      operation: {
        op: change.op,
        id: change.record.value.id,
        kind: change.record.kind,
        blob: toBase64Url(bytes),
      },
      bytes,
    };
  }

  async function uploadQueue(): Promise<number> {
    if (queue.size === 0) return 0;
    const startedAt = epoch;
    const token = await requireToken();
    const pending = [...queue.entries()]
      .sort(([, a], [, b]) => a.queuedAt - b.queuedAt)
      .map(([id, { kind, blob }]) => ({
        id,
        kind,
        blob,
        operation: { op: 'create', id, kind, blob: toBase64Url(blob) } as PushOperation,
      }));
    let uploaded = 0;
    for (const batch of chunk(pending)) {
      const results = await transport.push(
        token,
        batch.map(({ operation }) => operation),
      );
      if (startedAt !== epoch) return uploaded;
      const put: CachedRecord[] = [];
      batch.forEach(({ id, kind, blob }, index) => {
        const result = results[index];
        const entry = entries.get(id);
        queue.delete(id);
        if (result?.applied && result.version !== null && entry !== undefined) {
          entries.set(id, { ...entry, version: result.version, queued: false });
          put.push({ id, kind, version: result.version, blob });
        } else if (entry?.queued) {
          // Already on the server (a retry whose first answer was lost): the pull brings it.
          entries.delete(id);
        }
      });
      uploaded += batch.length;
      await cache.write({ put, dequeue: batch.map(({ id }) => id) });
      notify();
    }
    return uploaded;
  }

  /** Uploads the queue; one upload at a time, so nothing is ever sent twice concurrently. */
  function flushQueue(): Promise<number> {
    if (flushing === null) {
      flushing = uploadQueue().finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  async function pullChanges(): Promise<{ received: number; skipped: number }> {
    const startedAt = epoch;
    const token = await requireToken();
    const key = await requireKey();
    let received = 0;
    let skipped = 0;
    let restarted = false;
    for (;;) {
      const page = await transport.pull(token, cursor);
      if (startedAt !== epoch) return { received, skipped };
      if (Number(page.meta.nextCursor) < Number(cursor) && !restarted) {
        // The server is behind this device's cursor (restored database): start over.
        restarted = true;
        const known = [...entries.entries()].filter(([, entry]) => !entry.queued);
        for (const [id] of known) entries.delete(id);
        cursor = '0';
        await cache.write({ remove: known.map(([id]) => id), cursor });
        continue;
      }
      const put: CachedRecord[] = [];
      const remove: string[] = [];
      const dequeue: string[] = [];
      for (const record of page.records) {
        const current = entries.get(record.id);
        if (current?.version != null && current.version >= record.version) continue;
        if (current?.queued) {
          queue.delete(record.id);
          dequeue.push(record.id);
        }
        received += 1;
        if (record.deleted || record.blob === null) {
          if (current !== undefined) {
            entries.delete(record.id);
            remove.push(record.id);
          }
          continue;
        }
        let value: RecordValue;
        const blob = fromBase64Url(record.blob);
        try {
          value = await openRecord(key, record.id, record.kind, blob);
        } catch {
          skipped += 1;
          continue;
        }
        if (startedAt !== epoch) return { received, skipped };
        entries.set(record.id, { record: value, version: record.version, queued: false });
        put.push({ id: record.id, kind: record.kind, version: record.version, blob });
      }
      cursor = page.meta.nextCursor;
      await cache.write({ put, remove, dequeue, cursor });
      notify();
      if (!page.meta.hasMore) return { received, skipped };
    }
  }

  async function runSync(): Promise<SyncSummary> {
    await open();
    const uploaded = await flushQueue();
    const { received, skipped } = await pullChanges();
    return { uploaded, received, skipped };
  }

  /** Sends changes that need the network and applies what the server accepted. */
  async function commit(changes: readonly Change[]): Promise<void> {
    if (!isOnline()) throw offline();
    await open();
    await flushQueue();
    const startedAt = epoch;
    const token = await requireToken();
    const key = await requireKey();
    const sealed = await Promise.all(changes.map((change) => seal(key, change)));
    for (const batch of chunk(sealed)) {
      const results = await transport.push(
        token,
        batch.map(({ operation }) => operation),
      );
      if (startedAt !== epoch) return;
      const put: CachedRecord[] = [];
      const remove: string[] = [];
      batch.forEach(({ change, bytes }, index) => {
        const result = results[index];
        if (change.op === 'delete') {
          entries.delete(change.id);
          remove.push(change.id);
          return;
        }
        if (!result?.applied || result.version === null || bytes === null) return;
        const { id } = change.record.value;
        const current = entries.get(id);
        if (current?.version != null && current.version > result.version) return;
        entries.set(id, { record: change.record, version: result.version, queued: false });
        put.push({ id, kind: change.record.kind, version: result.version, blob: bytes });
      });
      await cache.write({ put, remove });
      notify();
    }
  }

  async function enqueue(records: readonly RecordValue[]): Promise<void> {
    const startedAt = epoch;
    const key = await requireKey();
    const sealed = await Promise.all(records.map((record) => sealRecord(key, record)));
    if (startedAt !== epoch) return;
    const queued = records.map((record, index) => {
      lastQueuedAt = Math.max(now(), lastQueuedAt + 1);
      return {
        id: record.value.id,
        kind: record.kind,
        blob: sealed[index] as Uint8Array,
        queuedAt: lastQueuedAt,
      };
    });
    await cache.write({ enqueue: queued });
    for (const [index, entry] of queued.entries()) {
      queue.set(entry.id, { kind: entry.kind, blob: entry.blob, queuedAt: entry.queuedAt });
      entries.set(entry.id, { record: records[index] as RecordValue, version: null, queued: true });
    }
    notify();
  }

  function putItem(item: Item): Change {
    return { op: 'put', record: { kind: 'item', value: item } };
  }

  /** Items that use a tag, rewritten by `rewrite`. */
  function itemsWithTag(id: string, rewrite: (tagIds: readonly string[]) => string[]): Change[] {
    const at = now();
    return valuesOf('item')
      .filter((item) => item.tagIds.includes(id))
      .map((item) => putItem({ ...item, tagIds: rewrite(item.tagIds), updatedAt: at }));
  }

  return {
    open,

    sync() {
      if (syncing === null) {
        syncing = runSync().finally(() => {
          syncing = null;
        });
      }
      return syncing;
    },

    listItems,

    getItem(id) {
      const entry = entries.get(id);
      return entry?.record.kind === 'item' ? view(entry.record.value, entry.queued) : null;
    },

    search(filters) {
      return searchItems(listItems(), filters);
    },

    async saveLink(input) {
      await open();
      const url = httpUrl(input.url);
      const key = urlKey(url);
      for (const { record, queued } of entries.values()) {
        if (record.kind === 'item' && sameLink(record.value, key)) {
          return { ...view(record.value, queued), alreadySaved: true };
        }
      }
      const at = now();
      const { ids, created } = resolveTags(input.tags ?? [], at);
      if (input.priority != null && !isPriority(input.priority)) {
        throw new SyncError('INVALID_INPUT', 'Unknown priority');
      }
      const item = fitItem({
        id: newId(),
        url,
        source: input.source ?? detectSource(url),
        preview: input.preview ?? null,
        content: input.content ?? null,
        thumbnail: input.thumbnail ?? null,
        categoryId: category(input.categoryId ?? null)?.id ?? null,
        tagIds: ids,
        priority: input.priority ?? null,
        status: 'pending',
        savedAt: at,
        updatedAt: at,
        statusChangedAt: null,
      });
      const records: RecordValue[] = [
        ...created.map((value): RecordValue => ({ kind: 'tag', value })),
        { kind: 'item', value: item },
      ];
      let queued = !isOnline();
      if (!queued) {
        try {
          await commit(records.map((record) => ({ op: 'create', record })));
        } catch (error) {
          if (!canQueueAfter(error)) throw error;
          queued = true;
        }
      }
      if (queued) await enqueue(records);
      return { ...view(item, queued), alreadySaved: false };
    },

    async setReadResult(id, result) {
      const { value } = requireEntry(id, 'item');
      const canonicalUrl = result.canonicalUrl ?? value.canonicalUrl;
      const item = fitItem({
        ...value,
        source: result.source ?? value.source,
        ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
        preview: result.preview,
        content: result.content,
        thumbnail: result.thumbnail === undefined ? value.thumbnail : result.thumbnail,
        updatedAt: now(),
      });
      await commit([putItem(item)]);
    },

    async classify(id, change) {
      const { value } = requireEntry(id, 'item');
      const at = now();
      if (change.priority != null && !isPriority(change.priority)) {
        throw new SyncError('INVALID_INPUT', 'Unknown priority');
      }
      const tags = change.tags === undefined ? null : resolveTags(change.tags, at);
      const item: Item = {
        ...value,
        categoryId:
          change.categoryId === undefined
            ? value.categoryId
            : (category(change.categoryId)?.id ?? null),
        priority: change.priority === undefined ? value.priority : change.priority,
        tagIds: tags?.ids ?? value.tagIds,
        updatedAt: at,
      };
      await commit([
        ...(tags?.created ?? []).map((tagValue): Change => ({
          op: 'create',
          record: { kind: 'tag', value: tagValue },
        })),
        putItem(item),
      ]);
    },

    async setStatus(id, status) {
      const { value: before } = requireEntry(id, 'item');
      const at = now();
      await commit([putItem({ ...before, status, statusChangedAt: at, updatedAt: at })]);
      return async () => {
        const current = requireEntry(id, 'item').value;
        await commit([
          putItem({
            ...current,
            status: before.status,
            statusChangedAt: before.statusChangedAt,
            updatedAt: now(),
          }),
        ]);
      };
    },

    async deleteItem(id) {
      const { value: before } = requireEntry(id, 'item');
      await commit([{ op: 'delete', id, kind: 'item' }]);
      return async () => {
        await commit([putItem({ ...before, updatedAt: now() })]);
      };
    },

    listCategories() {
      const counts = new Map<string, number>();
      for (const item of listItems()) {
        if (item.category !== null) {
          counts.set(item.category.id, (counts.get(item.category.id) ?? 0) + 1);
        }
      }
      return valuesOf('category')
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)
        .map((value) => ({ ...value, count: counts.get(value.id) ?? 0 }));
    },

    async createCategory(name) {
      await open();
      const at = now();
      const orders = valuesOf('category').map(({ order }) => order);
      const value: Category = {
        id: newId(),
        name: categoryName(name),
        order: orders.length === 0 ? 0 : Math.max(...orders) + 1,
        createdAt: at,
        updatedAt: at,
      };
      await commit([{ op: 'create', record: { kind: 'category', value } }]);
      return value;
    },

    async renameCategory(id, name) {
      const { value } = requireEntry(id, 'category');
      await commit([
        {
          op: 'put',
          record: {
            kind: 'category',
            value: { ...value, name: categoryName(name), updatedAt: now() },
          },
        },
      ]);
    },

    async deleteCategory(id) {
      requireEntry(id, 'category');
      const at = now();
      // Items first: if the connection drops halfway, nothing is left pointing nowhere.
      const items = valuesOf('item')
        .filter((item) => item.categoryId === id)
        .map((item) => putItem({ ...item, categoryId: null, updatedAt: at }));
      await commit([...items, { op: 'delete', id, kind: 'category' }]);
    },

    async reorderCategories(ids) {
      const current = valuesOf('category');
      const known = new Set(current.map(({ id }) => id));
      if (
        ids.length !== known.size ||
        new Set(ids).size !== ids.length ||
        !ids.every((id) => known.has(id))
      ) {
        throw new SyncError('INVALID_INPUT', 'The new order must list every category once');
      }
      const at = now();
      const changes: Change[] = [];
      ids.forEach((id, order) => {
        const value = requireEntry(id, 'category').value;
        if (value.order !== order) {
          changes.push({
            op: 'put',
            record: { kind: 'category', value: { ...value, order, updatedAt: at } },
          });
        }
      });
      if (changes.length > 0) await commit(changes);
    },

    listTags() {
      const counts = new Map<string, number>();
      for (const item of listItems()) {
        for (const { id } of item.tags) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return valuesOf('tag')
        .map((value) => ({ ...value, count: counts.get(value.id) ?? 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },

    async renameTag(id, name) {
      const { value } = requireEntry(id, 'tag');
      const newName = tagName(name);
      const target = valuesOf('tag').find(
        (other) => other.id !== id && tagKey(other.name) === tagKey(newName),
      );
      if (target === undefined) {
        await commit([{ op: 'put', record: { kind: 'tag', value: { ...value, name: newName } } }]);
        return;
      }
      // Merge into the tag that already has the name.
      const merged = itemsWithTag(id, (tagIds) => [
        ...new Set(tagIds.map((tagId) => (tagId === id ? target.id : tagId))),
      ]);
      await commit([...merged, { op: 'delete', id, kind: 'tag' }]);
    },

    async deleteTag(id) {
      requireEntry(id, 'tag');
      const items = itemsWithTag(id, (tagIds) => tagIds.filter((tagId) => tagId !== id));
      await commit([...items, { op: 'delete', id, kind: 'tag' }]);
    },

    pendingUploads() {
      return queue.size;
    },

    async clear() {
      epoch += 1;
      entries.clear();
      queue.clear();
      cursor = '0';
      opened = null;
      try {
        await cache.clear();
      } finally {
        notify();
      }
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
