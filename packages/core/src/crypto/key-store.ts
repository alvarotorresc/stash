import { CryptoError } from './errors';
import type { DataKey } from './records';

/**
 * The device remembers the data key for 30 days from the last time the password was typed
 * (login, password change or recovery). Opening the app with the remembered key does not
 * extend the window.
 */
export const DATA_KEY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const DATABASE_VERSION = 1;
const STORE_NAME = 'keys';
const RECORD_KEY = 'data-key';

interface StoredDataKey {
  key: DataKey;
  savedAt: number;
  expiresAt: number;
}

export interface SaveDataKeyOptions {
  /**
   * `true` only right after the user typed the password (login, password change or
   * recovery): it starts a new 30-day window. With `false` the key is stored within the
   * current window, which is not extended; without a valid window the save is refused.
   */
  readonly afterPasswordEntry: boolean;
}

export interface DataKeyStore {
  /** Persists a non-extractable data key. See `SaveDataKeyOptions` for the 30-day window. */
  save(key: DataKey, options: SaveDataKeyOptions): Promise<void>;
  /**
   * Returns the key, or null when there is none, it has expired or the record looks wrong
   * (including a clock set back before the save). Anything but a valid key is deleted.
   */
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

function isStorableKey(key: unknown): key is DataKey {
  return key instanceof CryptoKey && !key.extractable && key.algorithm.name === 'AES-GCM';
}

/** Validates a record read back from disk; anything unexpected counts as expired. */
function isValid(stored: unknown, now: number): stored is StoredDataKey {
  if (typeof stored !== 'object' || stored === null) return false;
  const { key, savedAt, expiresAt } = stored as Partial<Record<keyof StoredDataKey, unknown>>;
  return (
    isStorableKey(key) &&
    typeof savedAt === 'number' &&
    typeof expiresAt === 'number' &&
    Number.isFinite(savedAt) &&
    Number.isFinite(expiresAt) &&
    expiresAt - savedAt <= DATA_KEY_TTL_MS &&
    savedAt <= now &&
    now < expiresAt
  );
}

/**
 * Stores the CryptoKey object itself, which IndexedDB keeps as is: a non-extractable key stays
 * non-extractable, so its raw bytes are never exposed to JavaScript (D4, D32). That is a
 * property of the JavaScript API, not encryption at rest: the browser keeps the key material
 * in its profile, protected only by the device's own disk encryption.
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

  async function read(): Promise<StoredDataKey | null> {
    const stored: unknown = await run('readonly', (store) => store.get(RECORD_KEY));
    if (stored === undefined) return null;
    if (isValid(stored, now())) return stored;
    // Expired, tampered or corrupted: delete it as soon as it is seen.
    await clear();
    return null;
  }

  return {
    async save(key, { afterPasswordEntry }) {
      if (!isStorableKey(key)) {
        throw new CryptoError('INVALID_INPUT', 'Only a non-extractable data key can be stored');
      }
      const current = afterPasswordEntry ? null : await read();
      if (!afterPasswordEntry && current === null) {
        throw new CryptoError('INVALID_INPUT', 'A new 30-day window needs the password');
      }
      const savedAt = current?.savedAt ?? now();
      const stored: StoredDataKey = {
        key,
        savedAt,
        expiresAt: current?.expiresAt ?? savedAt + DATA_KEY_TTL_MS,
      };
      await run('readwrite', (store) => store.put(stored, RECORD_KEY));
    },

    async load() {
      return (await read())?.key ?? null;
    },

    clear,
  };
}
