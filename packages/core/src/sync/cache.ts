/**
 * Local copy of the account's records, in IndexedDB, encrypted at rest.
 *
 * It stores the blobs exactly as the server sent them (and the queue's blobs exactly as they
 * will be sent): ciphertext under the data key, which never leaves the device. Next to each
 * blob there is only what the server sees too: the id, the kind and the version. No index is
 * built on anything else; searching happens in memory over the decrypted copy.
 */
import type { RecordKind } from './protocol';

export interface CachedRecord {
  readonly id: string;
  readonly kind: RecordKind;
  readonly version: number;
  /** Encrypted blob, as the server sent it. */
  readonly blob: Uint8Array;
}

/** A new record waiting for the connection: the encrypted `create` operation, ready to send. */
export interface QueuedRecord {
  readonly id: string;
  readonly kind: RecordKind;
  readonly blob: Uint8Array;
  /** Order of arrival; the queue is uploaded in this order. */
  readonly queuedAt: number;
}

export interface CacheSnapshot {
  readonly records: readonly CachedRecord[];
  readonly queue: readonly QueuedRecord[];
  /** Where the next pull starts; '0' for nothing pulled yet. */
  readonly cursor: string;
}

export interface RecordCache {
  load(): Promise<CacheSnapshot>;
  /** Stores and removes records, and optionally moves the cursor, in one transaction. */
  write(change: {
    put?: readonly CachedRecord[];
    remove?: readonly string[];
    cursor?: string;
    enqueue?: readonly QueuedRecord[];
    dequeue?: readonly string[];
  }): Promise<void>;
  /** Removes every record, the queue and the cursor. */
  clear(): Promise<void>;
}

const DATABASE_VERSION = 1;
const RECORDS = 'records';
const QUEUE = 'queue';
const META = 'meta';
const CURSOR_KEY = 'cursor';
const STORES = [RECORDS, QUEUE, META];

export interface IndexedDbRecordCacheOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

function copy(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export function createIndexedDbRecordCache({
  indexedDB = globalThis.indexedDB,
  databaseName = 'stash-cache',
}: IndexedDbRecordCacheOptions = {}): RecordCache {
  let database: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    if (database === null) {
      const request = indexedDB.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(RECORDS, { keyPath: 'id' });
        request.result.createObjectStore(QUEUE, { keyPath: 'id' });
        request.result.createObjectStore(META);
      };
      database = settle(request).then((db) => {
        // Another tab upgrading or deleting the database: let it, and reopen next time.
        db.onversionchange = () => {
          db.close();
          database = null;
        };
        return db;
      });
      database.catch(() => {
        database = null;
      });
    }
    return database;
  }

  return {
    async load() {
      const db = await open();
      const transaction = db.transaction(STORES, 'readonly');
      const records = settle(transaction.objectStore(RECORDS).getAll());
      const queue = settle(transaction.objectStore(QUEUE).getAll());
      const cursor = settle(transaction.objectStore(META).get(CURSOR_KEY));
      await done(transaction);
      return {
        records: (await records) as CachedRecord[],
        queue: ((await queue) as QueuedRecord[]).sort((a, b) => a.queuedAt - b.queuedAt),
        cursor: typeof (await cursor) === 'string' ? ((await cursor) as string) : '0',
      };
    },

    async write({ put = [], remove = [], cursor, enqueue = [], dequeue = [] }) {
      const db = await open();
      const transaction = db.transaction(STORES, 'readwrite');
      const records = transaction.objectStore(RECORDS);
      const queue = transaction.objectStore(QUEUE);
      for (const id of remove) records.delete(id);
      for (const { id, kind, version, blob } of put) {
        records.put({ id, kind, version, blob: copy(blob) });
      }
      for (const id of dequeue) queue.delete(id);
      for (const { id, kind, blob, queuedAt } of enqueue) {
        queue.put({ id, kind, blob: copy(blob), queuedAt });
      }
      if (cursor !== undefined) transaction.objectStore(META).put(cursor, CURSOR_KEY);
      await done(transaction);
    },

    async clear() {
      const db = await open();
      const transaction = db.transaction(STORES, 'readwrite');
      for (const store of STORES) transaction.objectStore(store).clear();
      await done(transaction);
    },
  };
}
