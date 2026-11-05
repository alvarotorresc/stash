import { CryptoError } from './errors';
import type { DataKey } from './records';

/** The device remembers the data key for 30 days from the last unlock (D32). */
export const DATA_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DATABASE_VERSION = 1;
const STORE_NAME = 'keys';
const RECORD_KEY = 'data-key';

interface StoredDataKey {
  key: DataKey;
  expiresAt: number;
}

export interface DataKeyStore {
  /** Persists a non-extractable data key and restarts the 30 days. */
  save(key: DataKey): Promise<void>;
  /** Returns the key, or null when there is none or it has expired. */
  load(): Promise<DataKey | null>;
  /** Forgets the key. Called on logout. */
  clear(): Promise<void>;
}

export interface IndexedDbDataKeyStoreOptions {
  indexedDB?: IDBFactory;
  now?: () => number;
  databaseName?: string;
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Stores the CryptoKey object itself, which IndexedDB keeps as is: a non-extractable key stays
 * non-extractable, so its raw bytes are never exposed to JavaScript (D4, D32).
 */
export function createIndexedDbDataKeyStore({
  indexedDB = globalThis.indexedDB,
  now = Date.now,
  databaseName = 'stash-keys',
}: IndexedDbDataKeyStoreOptions = {}): DataKeyStore {
  function openDatabase(): Promise<IDBDatabase> {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    return settle(request);
  }

  async function run<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
      });
      return request.result;
    } finally {
      database.close();
    }
  }

  async function clear(): Promise<void> {
    await run('readwrite', (store) => store.delete(RECORD_KEY));
  }

  return {
    async save(key) {
      if (key.extractable || key.algorithm.name !== 'AES-GCM') {
        throw new CryptoError('INVALID_INPUT', 'Only a non-extractable data key can be stored');
      }
      const stored: StoredDataKey = { key, expiresAt: now() + DATA_KEY_TTL_MS };
      await run('readwrite', (store) => store.put(stored, RECORD_KEY));
    },

    async load() {
      const stored = (await run('readonly', (store) => store.get(RECORD_KEY))) as
        StoredDataKey | undefined;
      if (stored === undefined) return null;
      if (now() >= stored.expiresAt) {
        await clear();
        return null;
      }
      return stored.key;
    },

    clear,
  };
}
