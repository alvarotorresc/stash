import { describe, expect, it, vi } from 'vitest';
import { SAVE_LINK_MENU_ID, registerSaveLinkMenu, type MenuApi } from './contextMenu';

function fakeApi() {
  let installed: () => void = () => {};
  let clicked: Parameters<MenuApi['contextMenus']['onClicked']['addListener']>[0] = () => {};
  const create = vi.fn();
  const api: MenuApi = {
    runtime: { onInstalled: { addListener: (callback) => (installed = callback) } },
    contextMenus: { create, onClicked: { addListener: (callback) => (clicked = callback) } },
  };
  return {
    api,
    create,
    install: () => installed(),
    click: (info: object) => clicked(info as never),
  };
}

describe('save link menu', () => {
  it('should add "Guardar en Stash" to links when installed', () => {
    const { api, create, install } = fakeApi();
    registerSaveLinkMenu(api, vi.fn());

    install();

    expect(create).toHaveBeenCalledWith({
      id: SAVE_LINK_MENU_ID,
      title: 'Guardar en Stash',
      contexts: ['link'],
    });
  });

  it('should save the clicked link', () => {
    const { api, click } = fakeApi();
    const save = vi.fn(() => Promise.resolve());
    registerSaveLinkMenu(api, save);

    click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl: 'https://example.com/a' });

    expect(save).toHaveBeenCalledWith({
      url: 'https://example.com/a',
      title: 'https://example.com/a',
    });
  });

  it('should ignore other menus and links that are not web pages', () => {
    const { api, click } = fakeApi();
    const save = vi.fn(() => Promise.resolve());
    registerSaveLinkMenu(api, save);

    click({ menuItemId: 'other', linkUrl: 'https://example.com/a' });
    click({ menuItemId: SAVE_LINK_MENU_ID, linkUrl: 'javascript:alert(1)' });
    click({ menuItemId: SAVE_LINK_MENU_ID });

    expect(save).not.toHaveBeenCalled();
  });
});
