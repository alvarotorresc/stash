import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_KEY_TTL_MS, createIndexedDbDataKeyStore } from './key-store';
import { decryptRecord, encryptRecord, type DataKey } from './records';

const START = Date.UTC(2026, 10, 5);

async function aesKey(extractable: boolean): Promise<DataKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, extractable, [
    'encrypt',
    'decrypt',
  ]);
  return key as DataKey;
}

function setUp() {
  const clock = { now: START };
  const factory = new IDBFactory();
  const store = createIndexedDbDataKeyStore({ indexedDB: factory, now: () => clock.now });
  return { clock, factory, store };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createIndexedDbDataKeyStore', () => {
  it('should load a key that decrypts what the saved key encrypted', async () => {
    const { store } = setUp();
    const key = await aesKey(false);
    const blob = await encryptRecord(key, 'record-1', new Uint8Array([1, 2, 3]));
    await store.save(key);

    const loaded = await store.load();

    expect(await decryptRecord(loaded as DataKey, 'record-1', blob)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('should keep the key non-extractable after persisting it', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false));

    const loaded = (await store.load()) as DataKey;

    expect(loaded.extractable).toBe(false);
  });

  it('should not let the persisted key be exported', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false));

    const loaded = (await store.load()) as DataKey;

    await expect(crypto.subtle.exportKey('raw', loaded)).rejects.toThrow();
  });

  it('should return null when nothing is stored', async () => {
    const { store } = setUp();

    expect(await store.load()).toBeNull();
  });

  it('should still return the key just before 30 days', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false));
    clock.now = START + DATA_KEY_TTL_MS - 1;

    expect(await store.load()).not.toBeNull();
  });

  it('should return null after 30 days', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false));
    clock.now = START + DATA_KEY_TTL_MS;

    expect(await store.load()).toBeNull();
  });

  it('should delete an expired key', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false));
    clock.now = START + DATA_KEY_TTL_MS;
    await store.load();

    clock.now = START;

    expect(await store.load()).toBeNull();
  });

  it('should count the 30 days from the last save', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false));
    clock.now = START + DATA_KEY_TTL_MS - 1;
    await store.save(await aesKey(false));

    clock.now = START + DATA_KEY_TTL_MS + 1;

    expect(await store.load()).not.toBeNull();
  });

  it('should forget the key on clear, as when logging out', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false));

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('should be readable from another store on the same database', async () => {
    const { factory, store } = setUp();
    await store.save(await aesKey(false));

    const other = createIndexedDbDataKeyStore({ indexedDB: factory, now: () => START });

    expect(await other.load()).not.toBeNull();
  });

  it('should refuse to persist an extractable key', async () => {
    const { store } = setUp();

    await expect(store.save(await aesKey(true))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('should refuse to persist a key that is not AES-GCM', async () => {
    const { store } = setUp();
    const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);

    await expect(store.save(hmac as DataKey)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('should use the global indexedDB and clock by default', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const store = createIndexedDbDataKeyStore();
    await store.save(await aesKey(false));

    expect(await store.load()).not.toBeNull();
  });

  it('should reject when the database cannot be opened', async () => {
    const factory = new IDBFactory();
    await new Promise<void>((resolve) => {
      const request = factory.open('stash-keys', 99);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const store = createIndexedDbDataKeyStore({ indexedDB: factory });

    await expect(store.load()).rejects.toThrow();
  });
});
