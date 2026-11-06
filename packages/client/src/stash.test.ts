import {
  AccountApiError,
  CryptoError,
  createIndexedDbDataKeyStore,
  createMemorySessionStore,
  type SessionStore,
} from '@stash/core';
import { SyncError, createIndexedDbRecordCache } from '@stash/core/sync';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createStash, type Stash } from './stash';
import { FakeBackend, webPage } from './test/backend';

const EMAIL = 'maria@ejemplo.com';
const PASSWORD = 'calabaza-asada-2026';
const URL_A = 'https://blog.example.com/despensa';
const URL_B = 'https://blog.example.com/otono';
const BODY_WORD = 'garbanzos';

interface Device {
  stash: Stash;
  factory: IDBFactory;
  sessionStore: SessionStore;
  events: EventTarget;
}

const opened: Stash[] = [];

afterEach(async () => {
  for (const stash of opened.splice(0)) {
    await stash.idle();
    stash.dispose();
  }
});

/** One app on one device. Passing the same stores again is the app opening again. */
function device(
  backend: FakeBackend,
  stores: Partial<Pick<Device, 'factory' | 'sessionStore'>> = {},
): Device {
  const factory = stores.factory ?? new IDBFactory();
  const sessionStore = stores.sessionStore ?? createMemorySessionStore();
  const events = new EventTarget();
  const stash = createStash({
    baseUrl: 'https://stash.test',
    fetch: backend.fetch,
    sessionStore,
    dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
    cache: createIndexedDbRecordCache({ indexedDB: factory }),
    isOnline: () => backend.online,
    events,
  });
  opened.push(stash);
  return { stash, factory, sessionStore, events };
}

function articleAt(backend: FakeBackend, url: string, title: string) {
  const words = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(' ');
  backend.pages.set(url, webPage(url, title, [words, `${words} ${BODY_WORD}`, words]));
}

async function registered(backend = new FakeBackend()) {
  const phone = device(backend);
  const { recoveryCode } = await phone.stash.register({ email: EMAIL, password: PASSWORD });
  await phone.stash.idle();
  return { backend, phone, recoveryCode };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (error instanceof AccountApiError || error instanceof SyncError) return error.code;
  if (error instanceof CryptoError) return error.code;
  return String(error);
}

/** How many values are stored in the record cache of a device (records and queue). */
async function cachedValues(factory: IDBFactory): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('stash-cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  let count = 0;
  for (const name of db.objectStoreNames) {
    if (name === 'meta') continue;
    count += await new Promise<number>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  db.close();
  return count;
}

describe('createStash', () => {
  describe('account', () => {
    it('should register, return the recovery code once and leave the data unlocked', async () => {
      const { phone, recoveryCode } = await registered();

      expect({
        code: /^[A-Z0-9]{28}$/.test(recoveryCode.replace(/[\s-]/g, '')),
        session: (await phone.stash.session())?.email,
      }).toEqual({ code: true, session: EMAIL });
    });

    it('should unlock on opening again without asking for the password', async () => {
      const { backend, phone } = await registered();
      articleAt(backend, URL_A, 'La despensa');
      await phone.stash.save(URL_A);
      await phone.stash.idle();

      const again = device(backend, phone);
      backend.online = false;
      const session = await again.stash.session();
      await again.stash.start();

      expect({
        email: session?.email,
        titles: again.stash.sync.listItems().map((item) => item.title),
      }).toEqual({ email: EMAIL, titles: ['La despensa'] });
    });

    it('should log in on another device and see the same drawer', async () => {
      const { backend, phone } = await registered();
      articleAt(backend, URL_A, 'La despensa');
      await phone.stash.save(URL_A);
      await phone.stash.idle();

      const laptop = device(backend);
      await laptop.stash.login({ email: EMAIL, password: PASSWORD });
      await laptop.stash.idle();

      expect(laptop.stash.sync.listItems().map((item) => item.title)).toEqual(['La despensa']);
    });

    it('should say when the password is wrong', async () => {
      const { backend } = await registered();
      const laptop = device(backend);

      expect(await codeOf(laptop.stash.login({ email: EMAIL, password: 'otra-cosa-larga' }))).toBe(
        'INVALID_CREDENTIALS',
      );
      expect(await laptop.stash.session()).toBeNull();
    });

    it('should log out and forget the data key, the cache and the queue', async () => {
      const { backend, phone } = await registered();
      await phone.stash.save(URL_A);
      backend.online = false;
      await phone.stash.save(URL_B);
      backend.online = true;

      await phone.stash.logout();

      expect({
        session: await phone.stash.session(),
        items: phone.stash.sync.listItems(),
        queue: phone.stash.sync.pendingUploads(),
        cached: await cachedValues(phone.factory),
        reopened: await device(backend, phone).stash.session(),
      }).toEqual({ session: null, items: [], queue: 0, cached: 0, reopened: null });
    });

    it('should recover with the code, hand out a new one and keep the data', async () => {
      const { backend, phone, recoveryCode } = await registered();
      articleAt(backend, URL_A, 'La despensa');
      await phone.stash.save(URL_A);
      await phone.stash.idle();
      const laptop = device(backend);

      const { recoveryCode: fresh } = await laptop.stash.recover({
        email: EMAIL,
        recoveryCode,
        newPassword: 'pimiento-rojo-asado',
      });
      await laptop.stash.idle();
      const reused = await codeOf(
        device(backend).stash.recover({
          email: EMAIL,
          recoveryCode,
          newPassword: 'otra-mas-larga',
        }),
      );

      expect({
        changed: fresh !== recoveryCode,
        titles: laptop.stash.sync.listItems().map((item) => item.title),
        reused,
      }).toEqual({ changed: true, titles: ['La despensa'], reused: 'INVALID_CREDENTIALS' });
    });

    it('should change the password and log in with the new one', async () => {
      const { backend, phone } = await registered();

      await phone.stash.changePassword({
        currentPassword: PASSWORD,
        newPassword: 'pimiento-rojo-asado',
      });
      const laptop = device(backend);
      await laptop.stash.login({ email: EMAIL, password: 'pimiento-rojo-asado' });

      expect({
        phone: (await phone.stash.session())?.email,
        laptop: (await laptop.stash.session())?.email,
        old: await codeOf(device(backend).stash.login({ email: EMAIL, password: PASSWORD })),
      }).toEqual({ phone: EMAIL, laptop: EMAIL, old: 'INVALID_CREDENTIALS' });
    });

    it('should refuse to change the password without the current one', async () => {
      const { phone } = await registered();

      expect(
        await codeOf(
          phone.stash.changePassword({
            currentPassword: 'no-es-esta',
            newPassword: 'nueva-y-larga',
          }),
        ),
      ).toBe('INVALID_CREDENTIALS');
    });

    it('should delete the account only with the password, and forget everything', async () => {
      const { backend, phone } = await registered();
      await phone.stash.save(URL_A);
      let notified = 0;
      phone.stash.subscribe(() => (notified += 1));

      const wrong = await codeOf(phone.stash.deleteAccount({ password: 'no-es-esta' }));
      const stillIn = (await phone.stash.session())?.email;
      await phone.stash.deleteAccount({ password: PASSWORD });

      expect({
        wrong,
        stillIn,
        session: await phone.stash.session(),
        items: phone.stash.sync.listItems(),
        notified: notified > 0,
        users: backend.accounts.users.size,
      }).toEqual({
        wrong: 'INVALID_CREDENTIALS',
        stillIn: EMAIL,
        session: null,
        items: [],
        notified: true,
        users: 0,
      });
    });

    it('should go back to the login, keeping the email and the queue, when the server closes the session', async () => {
      const { backend, phone } = await registered();
      backend.online = false;
      await phone.stash.save(URL_A);
      backend.online = true;
      backend.accounts.sessions.clear();

      await phone.stash.refresh();

      expect({
        session: await phone.stash.session(),
        email: await phone.stash.lastEmail(),
        queue: phone.stash.sync.pendingUploads(),
      }).toEqual({ session: null, email: EMAIL, queue: 1 });
    });

    it('should upload the queue of the same account after logging in again', async () => {
      const { backend, phone } = await registered();
      backend.online = false;
      await phone.stash.save(URL_A);
      backend.online = true;
      backend.accounts.sessions.clear();
      await phone.stash.refresh();

      await phone.stash.login({ email: EMAIL, password: PASSWORD });
      await phone.stash.idle();

      expect({
        queue: phone.stash.sync.pendingUploads(),
        onServer: [...backend.records.rows(EMAIL).values()].filter((row) => row.blob).length,
      }).toEqual({ queue: 0, onServer: 1 });
    });

    it('should not show the data of the previous account to another one', async () => {
      const { backend, phone } = await registered();
      await phone.stash.save(URL_A);
      backend.accounts.sessions.clear();
      await phone.stash.refresh();

      await phone.stash.register({ email: 'otra@ejemplo.com', password: PASSWORD });

      expect(phone.stash.sync.listItems()).toEqual([]);
    });
  });

  describe('saving', () => {
    it('should save at once, then read the page on the device', async () => {
      const { backend, phone } = await registered();
      articleAt(backend, URL_A, 'Cómo ordenar la despensa');

      const saved = await phone.stash.save(URL_A);
      const before = { title: saved.title, queued: saved.queued, preview: saved.preview };
      await phone.stash.idle();
      const item = phone.stash.sync.getItem(saved.id);

      expect({
        before,
        after: {
          title: item?.title,
          kind: item?.content?.kind,
          found: phone.stash.sync.search({ query: BODY_WORD }).map((r) => r.item.id),
        },
      }).toEqual({
        before: { title: URL_A, queued: false, preview: null },
        after: { title: 'Cómo ordenar la despensa', kind: 'article', found: [saved.id] },
      });
    });

    it('should queue a save without connection and read it once back online', async () => {
      const { backend, phone } = await registered();
      articleAt(backend, URL_A, 'La despensa');
      backend.online = false;

      const saved = await phone.stash.save(URL_A);
      const extractedOffline = backend.extracted.length;
      backend.online = true;
      phone.events.dispatchEvent(new Event('online'));
      await phone.stash.idle();

      expect({
        queued: saved.queued,
        extractedOffline,
        item: phone.stash.sync.getItem(saved.id)?.title,
        queue: phone.stash.sync.pendingUploads(),
      }).toEqual({ queued: true, extractedOffline: 0, item: 'La despensa', queue: 0 });
    });

    it('should keep the bare link, without asking again, when the page cannot be fetched', async () => {
      const { backend, phone } = await registered();

      const saved = await phone.stash.save(URL_A);
      await phone.stash.idle();
      await phone.stash.refresh();

      expect({
        title: phone.stash.sync.getItem(saved.id)?.title,
        content: phone.stash.sync.getItem(saved.id)?.content,
        asked: backend.extracted.length,
      }).toEqual({ title: URL_A, content: { kind: 'none', text: '' }, asked: 1 });
    });

    it('should try again later when the proxy is only busy', async () => {
      const { backend, phone } = await registered();
      backend.pages.set(URL_A, { status: 429, code: 'RATE_LIMITED' });
      const saved = await phone.stash.save(URL_A);
      await phone.stash.idle();
      const unread = phone.stash.sync.getItem(saved.id)?.preview;

      articleAt(backend, URL_A, 'La despensa');
      await phone.stash.refresh();

      expect({ unread, title: phone.stash.sync.getItem(saved.id)?.title }).toEqual({
        unread: null,
        title: 'La despensa',
      });
    });

    it('should not lose a classification made while the page was being read', async () => {
      const { backend, phone } = await registered();
      articleAt(backend, URL_A, 'La despensa');

      const saved = await phone.stash.save(URL_A);
      await phone.stash.change((sync) => sync.classify(saved.id, { priority: 'high' }));
      await phone.stash.idle();
      const laptop = device(backend);
      await laptop.stash.login({ email: EMAIL, password: PASSWORD });
      await laptop.stash.idle();
      const synced = laptop.stash.sync.getItem(saved.id);

      expect({ title: synced?.title, priority: synced?.priority }).toEqual({
        title: 'La despensa',
        priority: 'high',
      });
    });

    it('should not read pages where there is no DOM', async () => {
      const backend = new FakeBackend();
      const factory = new IDBFactory();
      const stash = createStash({
        baseUrl: 'https://stash.test',
        fetch: backend.fetch,
        dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
        cache: createIndexedDbRecordCache({ indexedDB: factory }),
        isOnline: () => true,
        readPages: false,
        events: null,
      });
      opened.push(stash);
      await stash.register({ email: EMAIL, password: PASSWORD });

      const saved = await stash.save(URL_A);
      await stash.idle();

      expect({
        asked: backend.extracted.length,
        preview: stash.sync.getItem(saved.id)?.preview,
      }).toEqual({ asked: 0, preview: null });
    });
  });

  describe('changes', () => {
    it('should end the session when a change meets a closed session', async () => {
      const { backend, phone } = await registered();
      const saved = await phone.stash.save(URL_A);
      backend.accounts.sessions.clear();

      const code = await codeOf(
        phone.stash.change((sync) => sync.classify(saved.id, { priority: 'low' })),
      );

      expect({ code, session: await phone.stash.session() }).toEqual({
        code: 'UNAUTHORIZED',
        session: null,
      });
    });

    it('should keep going after a change fails', async () => {
      const { backend, phone } = await registered();
      const saved = await phone.stash.save(URL_A);
      backend.online = false;
      const offline = await codeOf(phone.stash.change((sync) => sync.setStatus(saved.id, 'read')));
      backend.online = true;

      await phone.stash.change((sync) => sync.setStatus(saved.id, 'read'));

      expect({ offline, status: phone.stash.sync.getItem(saved.id)?.status }).toEqual({
        offline: 'OFFLINE',
        status: 'read',
      });
    });
  });

  describe('connection', () => {
    it('should tell listeners when the connection changes, until unsubscribed', async () => {
      const { phone } = await registered();
      let calls = 0;
      const unsubscribe = phone.stash.subscribe(() => (calls += 1));

      phone.events.dispatchEvent(new Event('offline'));
      unsubscribe();
      phone.events.dispatchEvent(new Event('offline'));

      expect(calls).toBe(1);
    });

    it('should do nothing on refresh while locked', async () => {
      const backend = new FakeBackend();
      const { stash } = device(backend);

      await stash.refresh();

      expect(backend.records.pulls).toBe(0);
    });
  });
});
