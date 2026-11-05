import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATA_KEY_TTL_MS, createIndexedDbDataKeyStore } from './key-store';
import { decryptRecord, encryptRecord, type DataKey } from './records';

const START = Date.UTC(2026, 10, 5);
const DAY = 24 * 60 * 60 * 1000;
const AFTER_LOGIN = { afterPasswordEntry: true } as const;

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
    await store.save(key, AFTER_LOGIN);

    const loaded = await store.load();

    expect(await decryptRecord(loaded as DataKey, 'record-1', blob)).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('should keep the key non-extractable after persisting it', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);

    const loaded = (await store.load()) as DataKey;

    expect(loaded.extractable).toBe(false);
  });

  it('should not let the persisted key be exported', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);

    const loaded = (await store.load()) as DataKey;

    await expect(crypto.subtle.exportKey('raw', loaded)).rejects.toThrow();
  });

  it('should return null when nothing is stored', async () => {
    const { store } = setUp();

    expect(await store.load()).toBeNull();
  });

  it('should still return the key just before 30 days', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START + DATA_KEY_TTL_MS - 1;

    expect(await store.load()).not.toBeNull();
  });

  it('should return null after 30 days', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START + DATA_KEY_TTL_MS;

    expect(await store.load()).toBeNull();
  });

  it('should delete an expired key', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START + DATA_KEY_TTL_MS;
    await store.load();

    clock.now = START;

    expect(await store.load()).toBeNull();
  });

  it('should restart the 30 days when saving after the password was typed', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START + 29 * DAY;
    await store.save(await aesKey(false), AFTER_LOGIN);

    clock.now = START + 31 * DAY;

    expect(await store.load()).not.toBeNull();
  });

  it('should not restart the 30 days when saving over a valid key without the password', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START + 29 * DAY;
    await store.save(await aesKey(false), { afterPasswordEntry: false });

    clock.now = START + DATA_KEY_TTL_MS;

    expect(await store.load()).toBeNull();
  });

  it('should refuse to start a window without the password', async () => {
    const { store } = setUp();

    await expect(
      store.save(await aesKey(false), { afterPasswordEntry: false }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('should treat a clock set back before the save as expired, and delete the key', async () => {
    const { clock, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);
    clock.now = START - 365 * DAY;

    const loaded = await store.load();
    clock.now = START;

    expect({ loaded, after: await store.load() }).toEqual({ loaded: null, after: null });
  });

  it('should forget the key on clear, as when logging out', async () => {
    const { store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);

    await store.clear();

    expect(await store.load()).toBeNull();
  });

  it('should be readable from another store on the same database', async () => {
    const { factory, store } = setUp();
    await store.save(await aesKey(false), AFTER_LOGIN);

    const other = createIndexedDbDataKeyStore({ indexedDB: factory, now: () => START });

    expect(await other.load()).not.toBeNull();
  });

  it('should refuse to persist an extractable key', async () => {
    const { store } = setUp();

    await expect(store.save(await aesKey(true), AFTER_LOGIN)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('should refuse to persist a key that is not AES-GCM', async () => {
    const { store } = setUp();
    const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);

    await expect(store.save(hmac as DataKey, AFTER_LOGIN)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });

  it('should use the global indexedDB and clock by default', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    const store = createIndexedDbDataKeyStore();
    await store.save(await aesKey(false), AFTER_LOGIN);

    expect(await store.load()).not.toBeNull();
  });

  describe('with a corrupted or tampered record', () => {
    async function put(factory: IDBFactory, value: unknown): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        const request = factory.open('stash-keys', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('keys');
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('keys', 'readwrite');
          transaction.objectStore('keys').put(value, 'data-key');
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
        request.onerror = () => reject(request.error);
      });
    }

    const window = { savedAt: START, expiresAt: START + DATA_KEY_TTL_MS };

    it.each([
      ['no expiry', async () => ({ key: await aesKey(false), savedAt: START })],
      [
        'an expiry of NaN',
        async () => ({ key: await aesKey(false), savedAt: START, expiresAt: NaN }),
      ],
      [
        'a string expiry',
        async () => ({ ...window, key: await aesKey(false), expiresAt: 'never' }),
      ],
      [
        'an infinite expiry',
        async () => ({ ...window, key: await aesKey(false), expiresAt: Infinity }),
      ],
      ['no save time', async () => ({ key: await aesKey(false), expiresAt: window.expiresAt })],
      [
        'a window longer than 30 days',
        async () => ({ ...window, key: await aesKey(false), expiresAt: START + 31 * DAY }),
      ],
      ['an extractable key', async () => ({ ...window, key: await aesKey(true) })],
      ['a key that is not a CryptoKey', async () => ({ ...window, key: { type: 'secret' } })],
      [
        'a key that is not AES-GCM',
        async () => ({
          ...window,
          key: await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
        }),
      ],
      ['a record that is not an object', async () => 'data-key'],
      ['null', async () => null],
    ])('should treat %s as expired and delete it', async (_, record) => {
      const { clock, factory, store } = setUp();
      await put(factory, await record());
      clock.now = START + DAY;

      expect(await store.load()).toBeNull();
    });

    it('should delete the record itself, not only ignore it', async () => {
      const { clock, factory, store } = setUp();
      await put(factory, { key: await aesKey(false), savedAt: START });
      clock.now = START + DAY;
      await store.load();

      const raw = await new Promise<unknown>((resolve) => {
        const request = factory.open('stash-keys', 1);
        request.onsuccess = () => {
          const database = request.result;
          const get = database.transaction('keys').objectStore('keys').get('data-key');
          get.onsuccess = () => {
            database.close();
            resolve(get.result);
          };
        };
      });

      expect(raw).toBeUndefined();
    });
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
