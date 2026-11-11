import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ORIGIN, createExtensionStash, fetchWithoutCookies } from './client';
import { registerSaveLinkMenu, SAVE_LINK_MENU_ID } from './contextMenu';
import { createPopupService as createRealPopupService } from './popupService';
import { createMessageHandler } from './router';
import { PENDING_KEY, SESSION_KEY } from './storage';
import {
  createBackgroundActions,
  createBadgedPendingLinks,
  createExtensionBackgroundActions,
  createPopupService,
  type ServicesApi,
} from './services';
import { EMAIL, memoryArea, otherDevice, PASSWORD, profile } from './test-utils';

const URL_A = 'https://blog.example.com/despensa';
const URL_B = 'https://blog.example.com/otono';

const opened: { idle(): Promise<void>; dispose(): void }[] = [];

afterEach(async () => {
  for (const stash of opened.splice(0)) {
    await stash.idle();
    stash.dispose();
  }
  vi.restoreAllMocks();
});

function fakeApi(area = memoryArea()): ServicesApi & { badges: string[] } {
  const badges: string[] = [];
  return {
    badges,
    storage: { local: area },
    permissions: { request: vi.fn(() => Promise.resolve(true)) },
    action: {
      setBadgeText: ({ text }) => {
        badges.push(text);
      },
    },
    tabs: {
      query: () => Promise.resolve([{ id: 1, url: 'https://example.com/', title: 'T' }]),
    },
    scripting: { executeScript: () => Promise.reject(new Error('blocked')) },
  };
}

/** An account on another device, and the extension's profile ready to log in to it. */
async function account() {
  const device = profile();
  const phone = otherDevice(device.backend);
  opened.push(phone);
  await phone.register({ email: EMAIL, password: PASSWORD });
  const popup = device.stash(true);
  opened.push(popup);
  return { ...device, phone, popup };
}

describe('fetchWithoutCookies', () => {
  it('should send every request without credentials and keep the rest', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response('{}')));

    await fetchWithoutCookies('https://stash.alvarotc.com/api/health', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      credentials: 'include',
    });

    expect(fetchMock).toHaveBeenCalledWith('https://stash.alvarotc.com/api/health', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      credentials: 'omit',
    });
  });
});

describe('createExtensionStash', () => {
  it('should keep the session in the extension storage under the API origin', async () => {
    const fetchSpy = vi.fn((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      device.backend.fetch(String(input).replace(API_ORIGIN, 'https://stash.test'), init),
    );
    const device = profile();
    const phone = otherDevice(device.backend);
    opened.push(phone);
    await phone.register({ email: EMAIL, password: PASSWORD });
    const stash = createExtensionStash({
      area: device.area,
      readPages: false,
      fetch: fetchSpy as unknown as typeof fetch,
      isOnline: () => true,
      cache: undefined,
    });
    opened.push(stash);

    await stash.login({ email: EMAIL, password: PASSWORD });

    expect({
      stored: device.area.data.has(SESSION_KEY),
      origin: new URL(String(fetchSpy.mock.calls[0]?.[0])).origin,
    }).toEqual({ stored: true, origin: API_ORIGIN });
  });
});

describe('createBadgedPendingLinks', () => {
  it('should show how many links wait on the toolbar button, and clear it', async () => {
    const badges: string[] = [];
    const pending = createBadgedPendingLinks(memoryArea(), (text) => {
      badges.push(text);
    });

    await pending.add(URL_A);
    await pending.add(URL_B);
    await pending.remove(URL_A);
    await pending.clear();

    expect({ badges, list: await pending.list() }).toEqual({
      badges: ['1', '2', '1', ''],
      list: [],
    });
  });
});

describe('createPopupService', () => {
  it('should read the open tab and ask for the host permission when logging in', async () => {
    const api = fakeApi();
    const service = createPopupService(api);

    await expect(service.currentTab()).resolves.toEqual({
      url: 'https://example.com/',
      title: 'T',
    });
    await expect(service.getSession()).resolves.toBeNull();
    await service.login(EMAIL, PASSWORD).catch(() => {});
    expect(api.permissions.request).toHaveBeenCalledWith({ origins: [`${API_ORIGIN}/*`] });
  });
});

describe('the context menu with the real client', () => {
  /** The menu wired as the background does, over this profile. */
  async function menu(context: Awaited<ReturnType<typeof account>>, readPages = false) {
    const badges: string[] = [];
    const pending = createBadgedPendingLinks(context.area, (text) => {
      badges.push(text);
    });
    const actions = createBackgroundActions({
      pending,
      createStash: () => {
        const stash = context.stash(readPages);
        opened.push(stash);
        return stash;
      },
    });
    let click: (info: { menuItemId: string | number; linkUrl?: string }) => void = () => {};
    const done: Promise<unknown>[] = [];
    const handle = createMessageHandler(actions);
    registerSaveLinkMenu(
      {
        runtime: { onInstalled: { addListener: () => {} } },
        contextMenus: {
          removeAll: () => Promise.resolve(),
          create: () => {},
          onClicked: { addListener: (callback) => (click = callback) },
        },
      },
      (message) => {
        const answer = handle(message);
        done.push(answer);
        return answer;
      },
    );
    const pick = async (linkUrl: string) => {
      click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl });
      await Promise.all(done);
    };
    return { pending, badges, pick };
  }

  it('should save the link through the real client when the session is unlocked', async () => {
    const context = await account();
    await context.popup.login({ email: EMAIL, password: PASSWORD });
    const { pending, pick } = await menu(context);

    await pick(URL_A);
    const readByBackground = context.backend.extracted.length;
    const reader = otherDevice(context.backend);
    opened.push(reader);
    await reader.login({ email: EMAIL, password: PASSWORD });
    await reader.idle();

    expect({
      waiting: await pending.list(),
      saved: reader.sync.listItems().map((item) => item.url),
      readByBackground,
    }).toEqual({ waiting: [], saved: [URL_A], readByBackground: 0 });
  });

  it('should keep the link, and show it on the button, when there is no session', async () => {
    const context = await account();
    const { pending, badges, pick } = await menu(context);

    await pick(URL_A);

    expect({
      waiting: await pending.list(),
      badges,
      session: context.area.data.has(SESSION_KEY),
    }).toEqual({
      waiting: [URL_A],
      badges: ['1'],
      session: false,
    });
    expect(context.area.data.get(PENDING_KEY)).toEqual([URL_A]);
  });

  it('should keep the link after a logout from the popup, not save it into the closed account', async () => {
    const context = await account();
    await context.popup.login({ email: EMAIL, password: PASSWORD });
    const { pending, pick } = await menu(context);
    await context.popup.logout();

    await pick(URL_B);

    expect(await pending.list()).toEqual([URL_B]);
    const rows = [...context.backend.records.accounts.values()].reduce((n, r) => n + r.size, 0);
    expect(rows).toBe(0);
  });

  it('should keep the link when saving fails with an unlocked session', async () => {
    const context = await account();
    await context.popup.login({ email: EMAIL, password: PASSWORD });
    const pending = createBadgedPendingLinks(context.area, () => {});
    const stash = context.stash(false);
    opened.push(stash);
    vi.spyOn(stash, 'save').mockRejectedValue(new Error('boom'));

    await createBackgroundActions({ pending, createStash: () => stash }).saveLink(URL_A);

    expect(await pending.list()).toEqual([URL_A]);
  });

  it('should be saved by the popup once unlocked', async () => {
    const context = await account();
    const { pending, pick } = await menu(context);
    await pick(URL_A);
    await context.popup.login({ email: EMAIL, password: PASSWORD });
    const service = createRealPopupService({
      stash: context.popup,
      tabApi: fakeApi(),
      pending,
      requestHostAccess: () => Promise.resolve(true),
    });

    const saved = await service.savePendingLinks();

    expect({
      saved,
      waiting: await pending.list(),
      listed: (await service.listItems()).map((i) => i.id).length,
    }).toEqual({
      saved: 1,
      waiting: [],
      listed: 1,
    });
  });
});

describe('createExtensionBackgroundActions', () => {
  it('should keep the link waiting, with the real stores, when nobody is logged in', async () => {
    const api = fakeApi();

    await createExtensionBackgroundActions(api).saveLink(URL_A);

    expect({
      waiting: (await api.storage.local.get(PENDING_KEY))[PENDING_KEY],
      badges: api.badges,
    }).toEqual({
      waiting: [URL_A],
      badges: ['1'],
    });
  });
});
