import { FakeBackend, webPage } from '@stash/client/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { realDevice } from '../../test-utils';
import { AccountError, ChangeError, type StashService } from '../service';
import { passwordStrength } from './realService';

const EMAIL = 'maria@ejemplo.com';
const PASSWORD = 'calabaza-asada-2026';
const URL_A = 'https://blog.example.com/despensa';
const URL_B = 'https://www.reddit.com/r/askspain/comments/abc/x/';

const devices: ReturnType<typeof realDevice>[] = [];

afterEach(async () => {
  for (const device of devices.splice(0)) {
    await device.stash.idle();
    device.stash.dispose();
  }
});

function device(backend = new FakeBackend()) {
  const created = realDevice(backend);
  devices.push(created);
  return created;
}

async function signedUp(backend = new FakeBackend()) {
  const phone = device(backend);
  const { recoveryCode } = await phone.service.register(EMAIL, PASSWORD);
  await phone.service.getSession();
  await phone.stash.idle();
  return { ...phone, recoveryCode };
}

async function failure(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  if (error instanceof AccountError || error instanceof ChangeError) {
    return `${error.name}:${error.code}`;
  }
  return String(error);
}

async function itemByUrl(service: StashService, url: string) {
  const item = (await service.listItems()).find((entry) => entry.url === url);
  if (!item) throw new Error(`No item for ${url}`);
  return item;
}

describe('createRealService', () => {
  describe('account', () => {
    it('should register and hand the recovery code without separators', async () => {
      const { service, recoveryCode } = await signedUp();
      const session = await service.getSession();

      expect({
        code: recoveryCode,
        email: session?.email,
        last: service.lastEmail(),
        remembered: (session?.rememberedUntil.getTime() ?? 0) > Date.now(),
      }).toEqual({
        code: expect.stringMatching(/^[0-9A-Z]{28}$/),
        email: EMAIL,
        last: EMAIL,
        remembered: true,
      });
    });

    it('should name account failures as the screens expect', async () => {
      const { backend, service, recoveryCode } = await signedUp();
      const laptop = device(backend).service;

      const results = {
        taken: await failure(laptop.register(EMAIL, PASSWORD)),
        wrongLogin: await failure(laptop.login(EMAIL, 'otra-cosa-larga')),
        badCode: await failure(laptop.recover(EMAIL, 'not-a-code', 'nueva-contraseña')),
        wrongCode: await failure(
          laptop.recover(
            EMAIL,
            recoveryCode.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')),
            'x'.repeat(12),
          ),
        ),
        short: await failure(laptop.register('nuevo@ejemplo.com', 'corta')),
        wrongPassword: await failure(service.changePassword('no-es-esta', 'nueva-y-larga')),
        wrongDelete: await failure(service.deleteAccount('no-es-esta')),
      };
      backend.online = false;
      const offline = await failure(laptop.login(EMAIL, PASSWORD));
      backend.online = true;
      backend.accounts.failures.set('/api/auth/prelogin', { status: 429, code: 'RATE_LIMITED' });
      const limited = await failure(laptop.login(EMAIL, PASSWORD));

      expect({ ...results, offline, limited }).toEqual({
        taken: 'AccountError:email-taken',
        wrongLogin: 'AccountError:invalid-credentials',
        badCode: 'AccountError:invalid-code',
        wrongCode: 'AccountError:invalid-code',
        short: 'AccountError:weak-password',
        wrongPassword: 'AccountError:wrong-password',
        wrongDelete: 'AccountError:wrong-password',
        offline: 'AccountError:offline',
        limited: 'AccountError:rate-limited',
      });
    });

    it('should pass on failures the screens have no name for', async () => {
      const backend = new FakeBackend();
      const { service } = device(backend);
      backend.accounts.failures.set('/api/auth/register', { status: 500, code: 'INTERNAL_ERROR' });

      expect(await failure(service.register(EMAIL, PASSWORD))).toMatch(/INTERNAL_ERROR|Error/);
    });

    it('should recover, show a new code and keep the data', async () => {
      const { backend, service, stash, recoveryCode } = await signedUp();
      backend.pages.set(URL_A, webPage(URL_A, 'La despensa', ['Texto del artículo.']));
      await service.save(URL_A);
      await stash.idle();
      const laptop = device(backend);

      const { recoveryCode: fresh } = await laptop.service.recover(
        EMAIL,
        recoveryCode,
        'pimiento-rojo-asado',
      );
      await laptop.service.getSession();
      await laptop.stash.idle();

      expect({
        fresh: fresh !== recoveryCode && /^[0-9A-Z]{28}$/.test(fresh),
        titles: (await laptop.service.listItems()).map((item) => item.title),
      }).toEqual({ fresh: true, titles: ['La despensa'] });
    });

    it('should change the password', async () => {
      const { backend, service } = await signedUp();

      await service.changePassword(PASSWORD, 'pimiento-rojo-asado');
      const laptop = device(backend).service;
      await laptop.login(EMAIL, 'pimiento-rojo-asado');

      expect((await laptop.getSession())?.email).toBe(EMAIL);
    });

    it('should log out, clearing the local copy and the queue', async () => {
      const { backend, service, stash } = await signedUp();
      await service.save(URL_A);
      backend.online = false;
      await service.save(URL_B);
      backend.online = true;

      await service.logout();

      expect({
        session: await service.getSession(),
        items: stash.sync.listItems().length,
        queue: stash.sync.pendingUploads(),
      }).toEqual({ session: null, items: 0, queue: 0 });
    });

    it('should delete the account with the password', async () => {
      const { backend, service } = await signedUp();

      await service.deleteAccount(PASSWORD);

      expect({ session: await service.getSession(), users: backend.accounts.users.size }).toEqual({
        session: null,
        users: 0,
      });
    });

    it('should measure passwords with the core rules', () => {
      expect([
        passwordStrength(''),
        passwordStrength('password123')?.blocked,
        passwordStrength('corta')?.level,
        passwordStrength('diez-letras')?.level,
        passwordStrength('catorce-letras')?.level,
        passwordStrength('una frase bien larga')?.level,
      ]).toEqual([null, true, 1, 2, 3, 4]);
    });
  });

  describe('items', () => {
    it('should tell when a saved link was already in the drawer, without a second item', async () => {
      const { backend, service, stash } = await signedUp();
      backend.pages.set(URL_A, webPage(URL_A, 'La despensa', ['Garbanzos y lentejas.']));
      const first = await service.save(URL_A);
      await stash.idle();

      const again = await service.save(`${URL_A}?utm_source=chat`);

      expect({
        firstMark: first.alreadySaved,
        id: again.id,
        alreadySaved: again.alreadySaved,
        listed: (await service.listItems()).length,
      }).toEqual({ firstMark: false, id: first.id, alreadySaved: true, listed: 1 });
    });

    it('should save at once and show the page once read', async () => {
      const { backend, service, stash } = await signedUp();
      backend.pages.set(URL_A, webPage(URL_A, 'La despensa', ['Garbanzos y lentejas.']));

      const saved = await service.save(URL_A);
      await stash.idle();
      const detail = await service.getItem(saved.id);

      expect({
        saved: { title: saved.title, queued: saved.queued, origin: saved.origin },
        detail: { title: detail?.title, kind: detail?.content.kind },
        found: (
          await service.search({
            query: 'lentejas',
            status: 'all',
            source: 'all',
            category: 'all',
            priority: 'all',
          })
        ).map((result) => ({ id: result.item.id, snippet: !!result.snippet })),
      }).toEqual({
        saved: { title: URL_A, queued: false, origin: 'blog.example.com' },
        detail: { title: 'La despensa', kind: 'article' },
        found: [{ id: saved.id, snippet: true }],
      });
    });

    it('should queue a save offline and upload it when the connection is back', async () => {
      const { backend, service, stash, events } = await signedUp();
      backend.online = false;

      const saved = await service.save(URL_B);
      backend.online = true;
      events.dispatchEvent(new Event('online'));
      await stash.idle();

      expect({ queued: saved.queued, now: (await itemByUrl(service, URL_B)).queued }).toEqual({
        queued: true,
        now: false,
      });
    });

    it('should not find an item that is gone', async () => {
      const { service } = await signedUp();

      expect(await service.getItem('missing')).toBeNull();
    });

    it('should classify with tag names and undo a status to the one before', async () => {
      const { service } = await signedUp();
      const saved = await service.save(URL_A);
      const category = await service.createCategory('Casa');

      await service.classify(saved.id, {
        categoryId: category.id,
        priority: 'medium',
        tags: ['cena', 'Otoño'],
      });
      await service.setStatus(saved.id, 'read');
      const undo = await service.setStatus(saved.id, 'discarded');
      await undo();
      const item = await itemByUrl(service, URL_A);

      expect({
        category: item.categoryId,
        priority: item.priority,
        tags: item.tags,
        status: item.status,
        counts: (await service.listCategories()).map((entry) => entry.count),
      }).toEqual({
        category: category.id,
        priority: 'medium',
        tags: ['cena', 'Otoño'],
        status: 'read',
        counts: [1],
      });
    });

    it('should refuse changes offline with a clear error', async () => {
      const { backend, service } = await signedUp();
      const saved = await service.save(URL_A);
      backend.online = false;

      expect(await failure(service.classify(saved.id, { priority: 'high' }))).toBe(
        'ChangeError:offline',
      );
      expect(await failure(service.setStatus(saved.id, 'read'))).toBe('ChangeError:offline');
    });

    it('should report a busy server and other failures apart', async () => {
      const { backend, service, stash } = await signedUp();
      const saved = await service.save(URL_A);
      await stash.idle();

      backend.records.nextError = { status: 429, code: 'RATE_LIMITED' };
      const busy = await failure(service.classify(saved.id, { priority: 'high' }));
      backend.records.nextError = { status: 413, code: 'QUOTA_EXCEEDED' };
      const quota = await failure(service.save(URL_B));

      expect({ busy, quota }).toEqual({
        busy: 'ChangeError:rate-limited',
        quota: 'ChangeError:failed',
      });
    });

    it('should find items without category with the "none" filter', async () => {
      const { service } = await signedUp();
      const first = await service.save(URL_A);
      await service.save(URL_B);
      const category = await service.createCategory('Casa');
      await service.classify(first.id, { categoryId: category.id });

      const results = await service.search({
        query: '',
        status: 'all',
        source: 'all',
        category: 'none',
        priority: 'all',
      });

      expect(results.map((result) => result.item.url)).toEqual([URL_B]);
    });

    it('should show decrypted thumbnails as blob URLs, made once per image', async () => {
      const { service, stash } = await signedUp();
      const saved = await service.save(URL_A);
      await stash.idle();
      await stash.change((sync) =>
        sync.setReadResult(saved.id, {
          preview: null,
          content: null,
          thumbnail: { type: 'image/webp', bytes: new Uint8Array([1, 2, 3]) },
        }),
      );

      const first = (await itemByUrl(service, URL_A)).thumbnail.src;
      const again = (await itemByUrl(service, URL_A)).thumbnail.src;
      await service.logout();

      expect({ blob: first?.startsWith('blob:'), same: first === again }).toEqual({
        blob: true,
        same: true,
      });
    });
  });

  describe('categories and tags', () => {
    it('should create, reuse, rename, reorder and delete categories', async () => {
      const { service } = await signedUp();
      const casa = await service.createCategory('Casa');
      const again = await service.createCategory(' casa ');
      const trabajo = await service.createCategory('Trabajo');

      await service.renameCategory(casa.id, 'Hogar');
      await service.reorderCategories([trabajo.id, casa.id]);
      const ordered = (await service.listCategories()).map((entry) => entry.name);
      await service.deleteCategory(trabajo.id);

      expect({
        reused: again.id === casa.id,
        ordered,
        left: (await service.listCategories()).map((entry) => entry.name),
      }).toEqual({ reused: true, ordered: ['Trabajo', 'Hogar'], left: ['Hogar'] });
    });

    it('should rename and delete tags by name', async () => {
      const { service } = await signedUp();
      const saved = await service.save(URL_A);
      await service.classify(saved.id, { tags: ['cena', 'otoño'] });

      await service.renameTag('cena', 'cenas');
      await service.deleteTag('otoño');
      await service.renameTag('no-existe', 'nada');
      await service.deleteTag('no-existe');

      expect({
        tags: (await service.listTags()).map((tag) => `${tag.name}:${tag.count}`),
        item: (await itemByUrl(service, URL_A)).tags,
      }).toEqual({ tags: ['cenas:1'], item: ['cenas'] });
    });
  });

  describe('export and connection', () => {
    it('should export everything readable as JSON', async () => {
      const { backend, service, stash } = await signedUp();
      backend.pages.set(URL_A, webPage(URL_A, 'La despensa', ['Garbanzos.']));
      const saved = await service.save(URL_A);
      await stash.idle();
      const category = await service.createCategory('Casa');
      await service.classify(saved.id, { categoryId: category.id, tags: ['cena'] });

      const data = JSON.parse(await (await service.exportAll()).text()) as {
        items: { title: string; category: string; tags: string[]; text: string }[];
        categories: string[];
        tags: string[];
      };

      expect({
        item: data.items.map(({ title, category: name, tags }) => ({ title, name, tags })),
        text: data.items[0]?.text.includes('Garbanzos'),
        categories: data.categories,
        tags: data.tags,
      }).toEqual({
        item: [{ title: 'La despensa', name: 'Casa', tags: ['cena'] }],
        text: true,
        categories: ['Casa'],
        tags: ['cena'],
      });
    });

    it('should tell subscribers when the connection changes', async () => {
      const { backend, service, events } = await signedUp();
      let calls = 0;
      const unsubscribe = service.subscribe(() => (calls += 1));

      backend.online = false;
      events.dispatchEvent(new Event('offline'));
      unsubscribe();

      expect({ calls, online: service.isOnline() }).toEqual({ calls: 1, online: false });
    });
  });
});
