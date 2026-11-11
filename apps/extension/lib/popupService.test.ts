import { webPage } from '@stash/client/testing';
import { API_PATHS } from '@stash/core/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPopupService } from './popupService';
import { AccountError, type PopupService } from './service';
import { createBadgedPendingLinks } from './services';
import type { TabApi } from './tab';
import { EMAIL, otherDevice, PASSWORD, profile } from './test-utils';

const URL_A = 'https://blog.example.com/despensa';
const URL_B = 'https://blog.example.com/otono';
const WORDS = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ');

const opened: { idle(): Promise<void>; dispose(): void }[] = [];

afterEach(async () => {
  for (const stash of opened.splice(0)) {
    await stash.idle();
    stash.dispose();
  }
});

function articleHtml(title: string, extra = '') {
  return `<html><head><title>${title}</title><meta property="og:description" content="Resumen"></head><body><article><h1>${title}</h1><p>${WORDS}</p><p>${WORDS} garbanzos</p>${extra}<p>${WORDS}</p></article></body></html>`;
}

const noTab: TabApi = {
  tabs: { query: () => Promise.resolve([]) },
  scripting: { executeScript: () => Promise.reject(new Error('blocked')) },
};

/** The popup of an extension whose account exists on another device. */
async function popup(options: { access?: boolean; tabApi?: TabApi } = {}) {
  const device = profile();
  const phone = otherDevice(device.backend);
  opened.push(phone);
  await phone.register({ email: EMAIL, password: PASSWORD });
  const stash = device.stash(true);
  opened.push(stash);
  const requestHostAccess = vi.fn(() => Promise.resolve(options.access ?? true));
  const pending = createBadgedPendingLinks(device.area, () => {});
  const service = createPopupService({
    stash,
    tabApi: options.tabApi ?? noTab,
    pending,
    requestHostAccess,
  });
  return { ...device, phone, stash, service, pending, requestHostAccess };
}

async function signedIn(options?: Parameters<typeof popup>[0]) {
  const context = await popup(options);
  await context.service.login(EMAIL, PASSWORD);
  return context;
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (failure: unknown) => (failure instanceof AccountError ? failure.code : String(failure)),
  );

describe('accounts', () => {
  it('should log in, remember the email and open the session', async () => {
    const { service, area } = await popup();
    expect(await service.getSession()).toBeNull();

    await service.login(EMAIL, PASSWORD);

    expect({
      session: await service.getSession(),
      email: service.lastEmail(),
      stored: area.data.has('stash-session'),
    }).toEqual({ session: { email: EMAIL }, email: EMAIL, stored: true });
  });

  it('should ask for the host permission before anything else, and stop without it', async () => {
    const { service, backend, requestHostAccess } = await popup({ access: false });
    const calls = backend.accounts.calls.length;

    expect(await codeOf(service.login(EMAIL, PASSWORD))).toBe('no-access');
    expect({
      asked: requestHostAccess.mock.calls.length,
      calls: backend.accounts.calls.length - calls,
    }).toEqual({
      asked: 1,
      calls: 0,
    });
  });

  it.each([
    ['a wrong password', 'invalid-credentials'],
    ['no connection', 'offline'],
  ])('should name %s as %s', async (what, code) => {
    const { service, backend } = await popup();
    if (what === 'no connection') backend.online = false;

    expect(
      await codeOf(
        service.login(EMAIL, what === 'no connection' ? PASSWORD : 'otra-contraseña-larga'),
      ),
    ).toBe(code);
  });

  it('should name a rate limit', async () => {
    const { service, backend } = await popup();
    backend.accounts.failures.set(API_PATHS.prelogin, { status: 429, code: 'RATE_LIMITED' });

    expect(await codeOf(service.login(EMAIL, PASSWORD))).toBe('rate-limited');
  });

  it('should pass unexpected failures on as they are', async () => {
    const { service, backend } = await popup();
    backend.accounts.failures.set(API_PATHS.prelogin, { status: 500, code: 'INTERNAL_ERROR' });

    expect(await codeOf(service.login(EMAIL, PASSWORD))).not.toBe('resolved');
  });

  it('should close the session and forget the data, the queue and the waiting links', async () => {
    const { service, pending, area, stash } = await signedIn();
    await service.save({ url: URL_A, title: 'A', html: articleHtml('A') });
    await pending.add(URL_B);

    await service.logout();

    expect({
      session: await service.getSession(),
      email: service.lastEmail(),
      waiting: await pending.list(),
      stored: area.data.has('stash-session'),
      items: stash.sync.listItems().length,
    }).toEqual({ session: null, email: null, waiting: [], stored: false, items: 0 });
  });
});

describe('saving the open tab', () => {
  it('should store the page read from the tab and not ask the proxy for it', async () => {
    const { service, backend, stash } = await signedIn();

    const saved = await service.save({
      url: URL_A,
      title: 'La despensa',
      html: articleHtml('La despensa'),
    });
    await stash.idle();
    const detail = await service.getItem(saved.id);

    expect({
      title: saved.title,
      domain: saved.domain,
      alreadySaved: saved.alreadySaved,
      extracted: backend.extracted.length,
      kind: detail?.content.kind,
    }).toEqual({
      title: 'La despensa',
      domain: 'blog.example.com',
      alreadySaved: false,
      extracted: 0,
      kind: 'article',
    });
  });

  it('should say a link was already saved and keep one item', async () => {
    const { service, stash } = await signedIn();
    const first = await service.save({ url: URL_A, title: 'A', html: articleHtml('A') });

    const again = await service.save({ url: `${URL_A}#otra-parte`, title: 'A' });
    await stash.idle();

    expect({
      id: again.id,
      alreadySaved: again.alreadySaved,
      listed: (await service.listItems()).length,
    }).toEqual({
      id: first.id,
      alreadySaved: true,
      listed: 1,
    });
  });

  it('should save a page that could not be read and let the proxy read it', async () => {
    const { service, backend, stash } = await signedIn();
    backend.pages.set(URL_B, webPage(URL_B, 'El otoño', [WORDS, `${WORDS} garbanzos`, WORDS]));

    const saved = await service.save({ url: URL_B, title: ' Título de la pestaña ' });
    await stash.idle();
    const [listed] = await service.listItems();

    expect({ shown: saved.title, listed: listed?.title, extracted: backend.extracted }).toEqual({
      shown: 'Título de la pestaña',
      listed: 'El otoño',
      extracted: [URL_B],
    });
  });

  it('should refuse an address that is not a web page', async () => {
    const { service } = await signedIn();

    await expect(service.save({ url: 'javascript:alert(1)', title: 'x' })).rejects.toThrow(
      'Only web pages',
    );
  });

  it('should classify what it saved and offer the categories and tags', async () => {
    const { service, stash } = await signedIn();
    const saved = await service.save({ url: URL_A, title: 'A', html: articleHtml('A') });
    const category = await stash.change((sync) => sync.createCategory('Casa'));

    await service.classify(saved.id, {
      priority: 'high',
      categoryId: category.id,
      tags: ['orden'],
    });

    expect({
      categories: await service.listCategories(),
      tags: await service.listTags(),
      item: stash.sync.getItem(saved.id)?.priority,
    }).toEqual({
      categories: [{ id: category.id, name: 'Casa' }],
      tags: [{ name: 'orden', count: 1 }],
      item: 'high',
    });
  });

  it('should read the open tab through the browser API', async () => {
    const tabApi: TabApi = {
      tabs: { query: () => Promise.resolve([{ id: 1, url: 'https://example.com/', title: 'T' }]) },
      scripting: { executeScript: () => Promise.reject(new Error('blocked')) },
    };
    const { service } = await popup({ tabApi });

    expect(await service.currentTab()).toEqual({ url: 'https://example.com/', title: 'T' });
  });
});

describe('the list and the reading view', () => {
  async function withItems(): Promise<{ service: PopupService; ids: string[] }> {
    const { service, stash } = await signedIn();
    const a = await service.save({
      url: URL_A,
      title: 'A',
      html: articleHtml(
        'La despensa',
        '<script>alert(1)</script><img src="/x.png" onerror="alert(1)">',
      ),
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const b = await service.save({ url: URL_B, title: 'B' });
    await stash.idle();
    return { service, ids: [a.id, b.id] };
  }

  it('should list what is pending, newest first', async () => {
    const { service, ids } = await withItems();

    const items = await service.listItems();

    expect(items.map((item) => item.id)).toEqual([ids[1], ids[0]]);
    expect(items[1]).toMatchObject({
      title: 'La despensa',
      origin: 'blog.example.com',
      queued: false,
    });
  });

  it('should not list what was marked read or discarded', async () => {
    const { service, stash } = await signedIn();
    const saved = await service.save({ url: URL_A, title: 'A', html: articleHtml('A') });
    await stash.change((sync) => sync.setStatus(saved.id, 'discarded'));

    expect(await service.listItems()).toEqual([]);
  });

  it('should show an article sanitized, without scripts, handlers or images that load', async () => {
    const { service, ids } = await withItems();

    const detail = await service.getItem(ids[0]!);

    if (detail?.content.kind !== 'article') throw new Error('expected an article');
    expect({
      url: detail.url,
      meta: detail.content.meta.startsWith('blog.example.com · '),
      clean: !/<script|onerror|\ssrc=/.test(detail.content.html),
      text: detail.content.html.includes('garbanzos'),
    }).toEqual({ url: URL_A, meta: true, clean: true, text: true });
  });

  it('should show the preview of a link the proxy could not read', async () => {
    const { service, ids } = await withItems();

    const detail = await service.getItem(ids[1]!);

    expect(detail?.content).toEqual({ kind: 'preview' });
  });

  it('should show a queued link as waiting for the network', async () => {
    const { service, backend, stash } = await signedIn();
    backend.online = false;
    const saved = await service.save({ url: URL_A, title: 'A' });
    await stash.idle();

    expect(await service.getItem(saved.id)).toMatchObject({
      queued: true,
      content: { kind: 'none' },
    });
  });

  it('should escape content kept as text only', async () => {
    const { service, stash } = await signedIn();
    const saved = await service.save({ url: URL_A, title: 'A' });
    await stash.change((sync) =>
      sync.setReadResult(saved.id, {
        preview: null,
        content: { kind: 'article', text: 'Primera <b>línea</b>\n\nSegunda & última' },
      }),
    );

    const detail = await service.getItem(saved.id);

    if (detail?.content.kind !== 'article') throw new Error('expected an article');
    expect(detail.content.html).toBe(
      '<p>Primera &lt;b&gt;línea&lt;/b&gt;</p><p>Segunda &amp; última</p>',
    );
  });

  it('should show the description of a preview, when there is one', async () => {
    const { service, stash } = await signedIn();
    const saved = await service.save({ url: URL_A, title: 'A' });
    await stash.change((sync) =>
      sync.setReadResult(saved.id, {
        preview: {
          title: 'T',
          description: 'Una descripción',
          siteName: null,
          author: null,
          imageUrl: null,
          publishedAt: null,
        },
        content: { kind: 'none', text: '' },
      }),
    );

    expect((await service.getItem(saved.id))?.content).toEqual({
      kind: 'preview',
      description: 'Una descripción',
    });
  });

  it('should not find an item that does not exist', async () => {
    const { service } = await signedIn();

    expect(await service.getItem('nope')).toBeNull();
  });
});

describe('links picked from the menu while locked', () => {
  it('should save them once unlocked and stop waiting for them', async () => {
    const { service, pending, stash } = await signedIn();
    await pending.add(URL_A);
    await pending.add(URL_B);

    const saved = await service.savePendingLinks();
    await stash.idle();

    expect({
      saved,
      waiting: await pending.list(),
      listed: (await service.listItems()).length,
    }).toEqual({ saved: 2, waiting: [], listed: 2 });
  });

  it('should keep the ones it could not save for the next time', async () => {
    const { pending, stash } = await signedIn();
    const failing = { ...stash, save: vi.fn().mockRejectedValue(new Error('server down')) };
    const service = createPopupService({
      stash: failing as unknown as typeof stash,
      tabApi: noTab,
      pending,
      requestHostAccess: () => Promise.resolve(true),
    });
    await pending.add(URL_A);

    expect(await service.savePendingLinks()).toBe(0);
    expect(await pending.list()).toEqual([URL_A]);
  });
});
