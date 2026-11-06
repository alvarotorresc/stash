import { describe, expect, it, vi } from 'vitest';
import { SAVE_LINK_MENU_ID, registerSaveLinkMenu, type MenuApi } from './contextMenu';

function fakeApi() {
  let installed: () => void = () => {};
  let clicked: Parameters<MenuApi['contextMenus']['onClicked']['addListener']>[0] = () => {};
  const calls: string[] = [];
  const create = vi.fn(() => calls.push('create'));
  const removeAll = vi.fn(() => {
    calls.push('removeAll');
    return Promise.resolve();
  });
  const api: MenuApi = {
    runtime: { onInstalled: { addListener: (callback) => (installed = callback) } },
    contextMenus: {
      removeAll,
      create,
      onClicked: { addListener: (callback) => (clicked = callback) },
    },
  };
  return {
    api,
    create,
    calls,
    install: () => installed(),
    click: (info: object) => clicked(info as never),
  };
}

const dispatchOk = () => vi.fn(() => Promise.resolve({ ok: true as const }));

describe('save link menu', () => {
  it('should replace any previous menu with "Guardar en Stash" on links when installed', async () => {
    const { api, create, calls, install } = fakeApi();
    registerSaveLinkMenu(api, dispatchOk());

    install();
    await vi.waitFor(() => expect(create).toHaveBeenCalled());

    expect(calls).toEqual(['removeAll', 'create']);
    expect(create).toHaveBeenCalledWith({
      id: SAVE_LINK_MENU_ID,
      title: 'Guardar en Stash',
      contexts: ['link'],
    });
  });

  it('should send a save-link message with the clicked link', () => {
    const { api, click } = fakeApi();
    const dispatch = dispatchOk();
    registerSaveLinkMenu(api, dispatch);

    click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl: 'https://example.com/a' });

    expect(dispatch).toHaveBeenCalledWith({ type: 'save-link', url: 'https://example.com/a' });
  });

  it('should ignore other menus and links that are not web pages', () => {
    const { api, click } = fakeApi();
    const dispatch = dispatchOk();
    registerSaveLinkMenu(api, dispatch);

    click({ menuItemId: 'other', linkUrl: 'https://example.com/a' });
    click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl: 'javascript:alert(1)' });
    click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl: 'file:///etc/passwd' });
    click({ menuItemId: SAVE_LINK_MENU_ID });

    expect(dispatch).not.toHaveBeenCalled();
  });
});
