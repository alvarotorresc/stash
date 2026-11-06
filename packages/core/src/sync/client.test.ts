import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createAccountClient } from '../account/client';
import { createMemorySessionStore } from '../account/session-store';
import { fromBase64Url } from '../crypto/encoding';
import { decryptRecord, type DataKey } from '../crypto/records';
import { FakeServer, memoryDataKeyStore } from '../test/fake-account-server';
import { FakeRecordsServer } from '../test/fake-records-server';
import { createIndexedDbRecordCache } from './cache';
import { createSyncClient, type SyncClient } from './client';
import { SyncError } from './errors';

const URL_A = 'https://example.com/articles/secret-garden';
const TITLE_A = 'The secret garden of encrypted things';

async function dataKey(): Promise<DataKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return key as DataKey;
}

interface Device {
  client: SyncClient;
  factory: IDBFactory;
  network: { online: boolean };
}

async function setUp(
  options: {
    server?: FakeRecordsServer;
    key?: DataKey;
    token?: string | null;
    factory?: IDBFactory;
    withKey?: boolean;
  } = {},
) {
  const server = options.server ?? new FakeRecordsServer();
  const key = options.key ?? (await dataKey());
  const factory = options.factory ?? new IDBFactory();
  const network = { online: true };
  const token = options.token === undefined ? 'token-a' : options.token;
  let clock = Date.UTC(2026, 10, 6);
  const client = createSyncClient({
    baseUrl: 'https://stash.test',
    fetch: (input, init) => {
      if (!network.online) return Promise.reject(new TypeError('Failed to fetch'));
      return server.fetch(input, init);
    },
    getToken: async () => token,
    getDataKey: async () => (options.withKey === false ? null : key),
    cache: createIndexedDbRecordCache({ indexedDB: factory }),
    isOnline: () => network.online,
    now: () => (clock += 1000),
  });
  await client.open();
  const device: Device = { client, factory, network };
  return { ...device, server, key };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof SyncError ? error.code : String(error);
}

/** Every value in every store of the cache database, as stored. */
async function rawCache(factory: IDBFactory): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('stash-cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const values: unknown[] = [];
  for (const name of db.objectStoreNames) {
    const all = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    values.push(...all);
  }
  db.close();
  return values;
}

/** All text a stored value could reveal: strings, and byte arrays read as UTF-8. */
function textsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value instanceof Uint8Array) return [new TextDecoder().decode(value)];
  if (Array.isArray(value)) return value.flatMap(textsOf);
  if (typeof value === 'object' && value !== null) {
    return [...Object.keys(value), ...Object.values(value).flatMap(textsOf)];
  }
  return [];
}

async function cacheReveals(factory: IDBFactory, secrets: string[]): Promise<string[]> {
  const texts = textsOf(await rawCache(factory)).join('\n');
  return secrets.filter((secret) => texts.includes(secret));
}

const preview = {
  title: TITLE_A,
  description: 'A walk through ciphertext',
  siteName: 'Example',
  author: 'Ada',
  imageUrl: null,
  publishedAt: null,
};

describe('createSyncClient', () => {
  describe('saving online', () => {
    it('should upload an encrypted item and show it at once', async () => {
      const { client, server, key } = await setUp();

      const saved = await client.saveLink({ url: URL_A, preview });
      const row = server.rows().get(saved.id);
      const plaintext = new TextDecoder().decode(
        await decryptRecord(key, saved.id, fromBase64Url(row?.blob as string)),
      );

      expect({
        listed: client.listItems().map(({ id, title, queued }) => ({ id, title, queued })),
        serverBlobHasUrl: (row?.blob as string).includes('example.com'),
        decryptsToUrl: plaintext.includes(URL_A),
        kind: row?.kind,
      }).toEqual({
        listed: [{ id: saved.id, title: TITLE_A, queued: false }],
        serverBlobHasUrl: false,
        decryptsToUrl: true,
        kind: 'item',
      });
    });

    it('should save without classifying: pending, no category, no priority', async () => {
      const { client } = await setUp();

      const saved = await client.saveLink({ url: 'https://x.com/ada/status/1' });

      expect({
        status: saved.status,
        category: saved.category,
        priority: saved.priority,
        source: saved.source,
        title: saved.title,
      }).toEqual({
        status: 'pending',
        category: null,
        priority: null,
        source: 'x',
        title: 'https://x.com/ada/status/1',
      });
    });

    it('should create new tags and reuse existing ones ignoring case', async () => {
      const { client, server } = await setUp();
      await client.saveLink({ url: URL_A, tags: ['Recetas', 'cena'] });

      await client.saveLink({ url: 'https://example.com/2', tags: ['recetas  ', 'Nueva'] });

      expect({
        tags: client.listTags().map(({ name, count }) => ({ name, count })),
        tagRows: [...server.rows().values()].filter(({ kind }) => kind === 'tag').length,
      }).toEqual({
        tags: [
          { name: 'Recetas', count: 2 },
          { name: 'cena', count: 1 },
          { name: 'Nueva', count: 1 },
        ],
        tagRows: 3,
      });
    });

    it('should reject a link that is not http(s)', async () => {
      const { client } = await setUp();

      expect(await codeOf(client.saveLink({ url: 'javascript:alert(1)' }))).toBe('INVALID_INPUT');
    });
  });

  describe('offline queue', () => {
    it('should queue a save without connection and show it as queued', async () => {
      const { client, server, network } = await setUp();
      network.online = false;

      const saved = await client.saveLink({ url: URL_A });

      expect({
        queued: saved.queued,
        listed: client.listItems().map(({ queued }) => queued),
        pending: client.pendingUploads(),
        pushes: server.pushes.length,
      }).toEqual({ queued: true, listed: [true], pending: 1, pushes: 0 });
    });

    it('should upload the queue once when the connection is back, even if sync runs twice', async () => {
      const { client, server, network } = await setUp();
      network.online = false;
      const saved = await client.saveLink({ url: URL_A, tags: ['offline'] });
      network.online = true;

      const [first, second] = await Promise.all([client.sync(), client.sync()]);
      const third = await client.sync();

      expect({
        pushes: server.pushes.map((operations) =>
          operations.map(({ op, kind }) => `${op}:${kind}`),
        ),
        rows: server.rows().size,
        uploaded: [first.uploaded, second.uploaded, third.uploaded],
        queued: client.getItem(saved.id)?.queued,
        pending: client.pendingUploads(),
      }).toEqual({
        pushes: [['create:tag', 'create:item']],
        rows: 2,
        uploaded: [2, 2, 0],
        queued: false,
        pending: 0,
      });
    });

    it('should queue the save when the upload fails for lack of connection', async () => {
      const { client, server } = await setUp();
      server.offline = true;

      const saved = await client.saveLink({ url: URL_A });

      expect({ queued: saved.queued, pending: client.pendingUploads() }).toEqual({
        queued: true,
        pending: 1,
      });
    });

    it('should not duplicate a queued save whose first upload answer was lost', async () => {
      const { client, server, network } = await setUp();
      network.online = false;
      const saved = await client.saveLink({ url: URL_A });
      network.online = true;
      // The server stores it, but the device never hears back.
      const original = server.fetch;
      let dropped = false;
      const lossy: typeof fetch = async (input, init) => {
        const response = await original(input, init);
        if (init?.method === 'POST' && !dropped) {
          dropped = true;
          throw new TypeError('connection reset');
        }
        return response;
      };
      Object.defineProperty(server, 'fetch', { value: lossy });

      expect(await codeOf(client.sync())).toBe('OFFLINE');
      await client.sync();

      expect({
        rows: server.rows().size,
        items: client.listItems().map(({ id, queued }) => ({ id, queued })),
        pending: client.pendingUploads(),
      }).toEqual({ rows: 1, items: [{ id: saved.id, queued: false }], pending: 0 });
    });

    it('should keep the queue across a restart of the app', async () => {
      const first = await setUp();
      first.network.online = false;
      await first.client.saveLink({ url: URL_A });

      const second = await setUp({ server: first.server, key: first.key, factory: first.factory });
      await second.client.sync();

      expect({ pushes: first.server.pushes.length, rows: first.server.rows().size }).toEqual({
        pushes: 1,
        rows: 1,
      });
    });

    it('should refuse edits without connection with a clear error', async () => {
      const { client, network } = await setUp();
      const saved = await client.saveLink({ url: URL_A });
      const category = await client.createCategory('Leer');
      network.online = false;

      expect({
        classify: await codeOf(client.classify(saved.id, { priority: 'high' })),
        status: await codeOf(client.setStatus(saved.id, 'read')),
        remove: await codeOf(client.deleteItem(saved.id)),
        rename: await codeOf(client.renameCategory(category.id, 'Otra')),
        create: await codeOf(client.createCategory('Nueva')),
      }).toEqual({
        classify: 'OFFLINE',
        status: 'OFFLINE',
        remove: 'OFFLINE',
        rename: 'OFFLINE',
        create: 'OFFLINE',
      });
    });
  });

  describe('changes', () => {
    it('should classify an item', async () => {
      const { client } = await setUp();
      const saved = await client.saveLink({ url: URL_A, tags: ['a'] });
      const category = await client.createCategory('Cocina');

      await client.classify(saved.id, {
        categoryId: category.id,
        priority: 'high',
        tags: ['b', 'B'],
      });
      const item = client.getItem(saved.id);

      expect({
        category: item?.category?.name,
        priority: item?.priority,
        tags: item?.tags.map(({ name }) => name),
      }).toEqual({ category: 'Cocina', priority: 'high', tags: ['b'] });
    });

    it('should mark read and undo back to pending', async () => {
      const { client } = await setUp();
      const saved = await client.saveLink({ url: URL_A });

      const undo = await client.setStatus(saved.id, 'read');
      const marked = client.getItem(saved.id)?.status;
      await undo();

      expect({ marked, after: client.getItem(saved.id)?.status }).toEqual({
        marked: 'read',
        after: 'pending',
      });
    });

    it('should delete an item and bring it back with undo', async () => {
      const { client, server } = await setUp();
      const saved = await client.saveLink({ url: URL_A, preview });

      const undo = await client.deleteItem(saved.id);
      const afterDelete = client.listItems().length;
      const tombstone = server.rows().get(saved.id)?.blob;
      await undo();

      expect({
        afterDelete,
        tombstone,
        restored: client.getItem(saved.id)?.title,
      }).toEqual({ afterDelete: 0, tombstone: null, restored: TITLE_A });
    });

    it('should store what reading the link produced', async () => {
      const { client } = await setUp();
      const saved = await client.saveLink({ url: URL_A });

      await client.setReadResult(saved.id, {
        source: 'web',
        preview,
        content: { kind: 'article', html: '<p>Body</p>', text: 'Body words' },
      });

      expect(client.search({ query: 'words' }).map(({ item }) => item.id)).toEqual([saved.id]);
    });

    it('should fail with NOT_FOUND for an unknown item', async () => {
      const { client } = await setUp();

      expect(await codeOf(client.setStatus('missing', 'read'))).toBe('NOT_FOUND');
    });
  });

  describe('categories', () => {
    it('should create, rename and list categories in order of importance', async () => {
      const { client } = await setUp();
      const a = await client.createCategory('  Uno ');
      const b = await client.createCategory('Dos');
      await client.renameCategory(a.id, 'Primero');

      await client.reorderCategories([b.id, a.id]);

      expect(client.listCategories().map(({ name, order }) => ({ name, order }))).toEqual([
        { name: 'Dos', order: 0 },
        { name: 'Primero', order: 1 },
      ]);
    });

    it('should leave the items of a deleted category unclassified', async () => {
      const { client, server } = await setUp();
      const category = await client.createCategory('Temporal');
      const saved = await client.saveLink({ url: URL_A, categoryId: category.id });

      await client.deleteCategory(category.id);

      expect({
        items: client.listItems().map(({ id, category: c }) => ({ id, category: c })),
        categories: client.listCategories(),
        serverItem: server.rows().get(saved.id)?.blob !== null,
      }).toEqual({ items: [{ id: saved.id, category: null }], categories: [], serverItem: true });
    });

    it('should count the items of each category', async () => {
      const { client } = await setUp();
      const category = await client.createCategory('Leer');
      await client.saveLink({ url: URL_A, categoryId: category.id });
      await client.saveLink({ url: 'https://example.com/b', categoryId: category.id });

      expect(client.listCategories()[0]?.count).toBe(2);
    });

    it('should refuse an order that does not list every category once', async () => {
      const { client } = await setUp();
      const a = await client.createCategory('A');
      await client.createCategory('B');

      expect(await codeOf(client.reorderCategories([a.id, a.id]))).toBe('INVALID_INPUT');
    });

    it('should refuse an empty or too long name', async () => {
      const { client } = await setUp();

      expect({
        empty: await codeOf(client.createCategory('   ')),
        long: await codeOf(client.createCategory('x'.repeat(61))),
      }).toEqual({ empty: 'INVALID_INPUT', long: 'INVALID_INPUT' });
    });
  });

  describe('tags', () => {
    it('should rename a tag in one change', async () => {
      const { client, server } = await setUp();
      await client.saveLink({ url: URL_A, tags: ['viejo'] });
      const before = server.pushes.length;
      const id = client.listTags()[0]?.id as string;

      await client.renameTag(id, 'nuevo');

      expect({
        tags: client.listItems()[0]?.tags.map(({ name }) => name),
        pushedRecords: server.pushes.slice(before).flat().length,
      }).toEqual({ tags: ['nuevo'], pushedRecords: 1 });
    });

    it('should merge a tag renamed to the name of another', async () => {
      const { client } = await setUp();
      await client.saveLink({ url: URL_A, tags: ['uno', 'dos'] });
      await client.saveLink({ url: 'https://example.com/b', tags: ['uno'] });
      const uno = client.listTags().find(({ name }) => name === 'uno')?.id as string;

      await client.renameTag(uno, 'DOS');

      expect({
        tags: client.listTags().map(({ name, count }) => ({ name, count })),
        perItem: client.listItems().map(({ tags }) => tags.map(({ name }) => name)),
      }).toEqual({ tags: [{ name: 'dos', count: 2 }], perItem: [['dos'], ['dos']] });
    });

    it('should delete a tag and remove it from every item', async () => {
      const { client } = await setUp();
      await client.saveLink({ url: URL_A, tags: ['fuera', 'queda'] });
      const id = client.listTags().find(({ name }) => name === 'fuera')?.id as string;

      await client.deleteTag(id);

      expect(client.listItems()[0]?.tags.map(({ name }) => name)).toEqual(['queda']);
    });
  });

  describe('pulling changes', () => {
    it('should bring another device up to date, deletions included', async () => {
      const phone = await setUp();
      const desktop = await setUp({ server: phone.server, key: phone.key });
      const kept = await phone.client.saveLink({ url: URL_A, preview });
      const gone = await phone.client.saveLink({ url: 'https://example.com/gone' });
      await desktop.client.sync();
      const before = desktop.client.listItems().length;

      await phone.client.deleteItem(gone.id);
      await desktop.client.sync();

      expect({
        before,
        after: desktop.client.listItems().map(({ id, title }) => ({ id, title })),
      }).toEqual({ before: 2, after: [{ id: kept.id, title: TITLE_A }] });
    });

    it('should page through a first load', async () => {
      const phone = await setUp();
      phone.server.pageSize = 2;
      for (let index = 0; index < 5; index += 1) {
        await phone.client.saveLink({ url: `https://example.com/${index}` });
      }
      const desktop = await setUp({ server: phone.server, key: phone.key });

      const summary = await desktop.client.sync();

      expect({
        summary,
        items: desktop.client.listItems().length,
        pulls: phone.server.pulls,
      }).toEqual({ summary: { uploaded: 0, received: 5, skipped: 0 }, items: 5, pulls: 3 });
    });

    it('should apply the last write when two devices edit the same item', async () => {
      const phone = await setUp();
      const desktop = await setUp({ server: phone.server, key: phone.key });
      const saved = await phone.client.saveLink({ url: URL_A });
      await desktop.client.sync();

      await phone.client.classify(saved.id, { priority: 'low' });
      await desktop.client.classify(saved.id, { priority: 'high' });
      await phone.client.sync();

      expect([
        phone.client.getItem(saved.id)?.priority,
        desktop.client.getItem(saved.id)?.priority,
      ]).toEqual(['high', 'high']);
    });

    it('should skip a record it cannot decrypt', async () => {
      const { client, server } = await setUp();
      const other = await setUp({ server });
      await other.client.saveLink({ url: URL_A });

      const summary = await client.sync();

      expect({ summary, items: client.listItems() }).toEqual({
        summary: { uploaded: 0, received: 1, skipped: 1 },
        items: [],
      });
    });

    it('should reject a record whose kind the server changed', async () => {
      const phone = await setUp();
      const saved = await phone.client.saveLink({ url: URL_A });
      const row = phone.server.rows().get(saved.id);
      if (row !== undefined) row.kind = 'tag';
      const desktop = await setUp({ server: phone.server, key: phone.key });

      const summary = await desktop.client.sync();

      expect({
        summary,
        items: desktop.client.listItems(),
        tags: desktop.client.listTags(),
      }).toEqual({ summary: { uploaded: 0, received: 1, skipped: 1 }, items: [], tags: [] });
    });

    it('should start over when the server is behind its cursor', async () => {
      const phone = await setUp();
      await phone.client.saveLink({ url: URL_A });
      await phone.client.saveLink({ url: 'https://example.com/second' });
      await phone.client.sync();
      phone.server.restore();
      const fresh = await setUp({ server: phone.server, key: phone.key });
      await fresh.client.saveLink({ url: 'https://example.com/new' });

      await phone.client.sync();

      expect(phone.client.listItems().map(({ url }) => url)).toEqual(['https://example.com/new']);
    });

    it('should read the cache without connection after a restart', async () => {
      const first = await setUp();
      await first.client.saveLink({ url: URL_A, preview });

      const second = await setUp({ server: first.server, key: first.key, factory: first.factory });
      second.network.online = false;

      expect(second.client.listItems().map(({ title }) => title)).toEqual([TITLE_A]);
    });
  });

  describe('cache at rest', () => {
    it('should keep no title, URL, tag or category name in IndexedDB', async () => {
      const { client, factory, network } = await setUp();
      const category = await client.createCategory('Categoria secreta');
      await client.saveLink({
        url: URL_A,
        preview,
        content: { kind: 'article', text: 'cuerpo confidencial' },
        tags: ['etiqueta-secreta'],
        categoryId: category.id,
      });
      network.online = false;
      await client.saveLink({ url: 'https://example.com/queued-offline-link' });

      expect(
        await cacheReveals(factory, [
          'example.com',
          'secret-garden',
          TITLE_A,
          'Categoria secreta',
          'etiqueta-secreta',
          'cuerpo confidencial',
          'queued-offline-link',
        ]),
      ).toEqual([]);
    });

    it('should catch plaintext if it were stored (control for the check above)', async () => {
      const factory = new IDBFactory();
      const cache = createIndexedDbRecordCache({ indexedDB: factory });

      await cache.write({
        put: [
          {
            id: 'x',
            kind: 'item',
            version: 1,
            blob: new TextEncoder().encode(`{"url":"${URL_A}"}`),
          },
        ],
      });

      expect(await cacheReveals(factory, ['secret-garden'])).toEqual(['secret-garden']);
    });
  });

  describe('logout', () => {
    it('should wipe the cache, the queue and memory when the account logs out', async () => {
      const records = new FakeRecordsServer();
      const accounts = new FakeServer();
      const keys = memoryDataKeyStore();
      const factory = new IDBFactory();
      let sync: SyncClient | null = null;
      const fetchFn: typeof fetch = (input, init) =>
        new URL(String(input)).pathname.startsWith('/api/records')
          ? records.fetch(input, init)
          : accounts.fetch(input, init);
      const account = createAccountClient({
        baseUrl: 'https://stash.test',
        fetch: fetchFn,
        dataKeyStore: keys.store,
        sessionStore: createMemorySessionStore(),
        onLogout: () => sync?.clear(),
      });
      sync = createSyncClient({
        baseUrl: 'https://stash.test',
        fetch: fetchFn,
        getToken: async () => (await account.getSession())?.token ?? null,
        getDataKey: () => keys.store.load(),
        cache: createIndexedDbRecordCache({ indexedDB: factory }),
        isOnline: () => true,
      });
      await account.register({ email: 'ada@example.com', password: 'correct horse battery' });
      await sync.open();
      await sync.saveLink({ url: URL_A });
      records.offline = true;
      await sync.saveLink({ url: 'https://example.com/queued' });

      await account.logout();

      expect({
        items: sync.listItems(),
        pending: sync.pendingUploads(),
        stored: await rawCache(factory),
      }).toEqual({ items: [], pending: 0, stored: [] });
    });

    it('should not refill the cache with a pull that was running during the wipe', async () => {
      const { client, server, factory } = await setUp();
      await client.saveLink({ url: URL_A });
      server.beforePull = () => client.clear();

      await client.sync();

      expect({ items: client.listItems(), stored: await rawCache(factory) }).toEqual({
        items: [],
        stored: [],
      });
    });
  });

  describe('failures', () => {
    it('should drop cached records that no longer decrypt and pull everything again', async () => {
      const first = await setUp();
      await first.client.saveLink({ url: URL_A });
      const pullsBefore = first.server.pulls;

      // Same device storage, but a data key that does not open what is cached.
      const second = await setUp({ server: first.server, factory: first.factory });
      const stored = await rawCache(first.factory);
      await second.client.sync();

      expect({
        items: second.client.listItems(),
        cachedRecords: stored.filter((value) => (value as { version?: number }).version).length,
        pulled: first.server.pulls > pullsBefore,
      }).toEqual({ items: [], cachedRecords: 0, pulled: true });
    });

    it('should not queue a save the server refused', async () => {
      const { client, server } = await setUp();
      server.nextError = { status: 413, code: 'QUOTA_EXCEEDED' };

      expect({
        code: await codeOf(client.saveLink({ url: URL_A })),
        pending: client.pendingUploads(),
        items: client.listItems(),
      }).toEqual({ code: 'QUOTA_EXCEEDED', pending: 0, items: [] });
    });

    it('should refuse an unknown priority', async () => {
      const { client } = await setUp();

      expect(
        await codeOf(client.saveLink({ url: URL_A, priority: 'urgent' as unknown as 'high' })),
      ).toBe('INVALID_INPUT');
    });
  });

  describe('locked', () => {
    it('should fail with LOCKED without a data key or a session', async () => {
      const noKey = createSyncClient({
        getToken: async () => 'token-a',
        getDataKey: async () => null,
        cache: createIndexedDbRecordCache({ indexedDB: new IDBFactory() }),
        isOnline: () => true,
      });
      const noToken = await setUp({ token: null });

      expect({
        open: await codeOf(noKey.open()),
        sync: await codeOf(noToken.client.sync()),
      }).toEqual({ open: 'LOCKED', sync: 'LOCKED' });
    });
  });

  describe('subscribe', () => {
    it('should notify after changes until unsubscribed', async () => {
      const { client } = await setUp();
      const listener = vi.fn();
      const unsubscribe = client.subscribe(listener);
      await client.saveLink({ url: URL_A });
      const calls = listener.mock.calls.length;

      unsubscribe();
      await client.saveLink({ url: 'https://example.com/b' });

      expect({ notified: calls > 0, after: listener.mock.calls.length }).toEqual({
        notified: true,
        after: calls,
      });
    });
  });
});
