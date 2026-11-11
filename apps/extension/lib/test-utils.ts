import { createStash, type Stash, type ThumbnailMaker } from '@stash/client';
import { FakeBackend } from '@stash/client/testing';
import { createIndexedDbDataKeyStore, createMemorySessionStore } from '@stash/core';
import { createIndexedDbRecordCache } from '@stash/core/sync';
import { IDBFactory } from 'fake-indexeddb';
import { createExtensionStash } from './client';
import type { StorageArea } from './storage';

export const BASE_URL = 'https://stash.test';
export const EMAIL = 'maria@ejemplo.com';
export const PASSWORD = 'calabaza-asada-2026';

/** `storage.local` in memory. */
export function memoryArea(initial: Record<string, unknown> = {}): StorageArea & {
  data: Map<string, unknown>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    },
    async remove(key) {
      data.delete(key);
    },
  };
}

/** The extension on one browser profile: one storage area and one IndexedDB for all contexts. */
export function profile(backend = new FakeBackend()) {
  const area = memoryArea();
  const factory = new IDBFactory();
  /** A client as a context of the extension (the popup or the background) creates it. */
  const stash = (readPages: boolean, makeThumbnail?: ThumbnailMaker | null): Stash =>
    createExtensionStash({
      area,
      readPages,
      ...(makeThumbnail !== undefined && { makeThumbnail }),
      baseUrl: BASE_URL,
      fetch: backend.fetch,
      dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
      cache: createIndexedDbRecordCache({ indexedDB: factory }),
      isOnline: () => backend.online,
    });
  return { backend, area, factory, stash };
}

/** Another device of the same account (the PWA), to create the account and read what was saved. */
export function otherDevice(backend: FakeBackend): Stash {
  const factory = new IDBFactory();
  return createStash({
    baseUrl: BASE_URL,
    fetch: backend.fetch,
    sessionStore: createMemorySessionStore(),
    dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
    cache: createIndexedDbRecordCache({ indexedDB: factory }),
    isOnline: () => backend.online,
    events: null,
  });
}
