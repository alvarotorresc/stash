import { toHttpUrl, type Page } from './service';

export const SAVE_LINK_MENU_ID = 'stash-save-link';

/** The parts of the browser API the menu uses, so tests can pass a fake. */
export interface MenuApi {
  runtime: { onInstalled: { addListener(callback: () => void): void } };
  contextMenus: {
    create(properties: { id: string; title: string; contexts: ['link'] }): unknown;
    onClicked: {
      addListener(
        callback: (info: { menuItemId: string | number; linkUrl?: string }) => void,
      ): void;
    };
  };
}

/**
 * "Guardar en Stash" on any link. The page behind the link is not open, so
 * only its address is saved here; the title arrives when it is read.
 */
export function registerSaveLinkMenu(api: MenuApi, save: (page: Page) => Promise<unknown>) {
  api.runtime.onInstalled.addListener(() => {
    api.contextMenus.create({
      id: SAVE_LINK_MENU_ID,
      title: 'Guardar en Stash',
      contexts: ['link'],
    });
  });
  api.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== SAVE_LINK_MENU_ID) return;
    const url = toHttpUrl(info.linkUrl);
    if (url) void save({ url, title: url });
  });
}
