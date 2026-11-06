import { parseMessage, type Message, type MessageResponse } from './messages';

export const SAVE_LINK_MENU_ID = 'stash-save-link';

/** The parts of the browser API the menu uses, so tests can pass a fake. */
export interface MenuApi {
  runtime: { onInstalled: { addListener(callback: () => void): void } };
  contextMenus: {
    removeAll(): Promise<void>;
    create(properties: { id: string; title: string; contexts: ['link'] }): unknown;
    onClicked: {
      addListener(
        callback: (info: { menuItemId: string | number; linkUrl?: string }) => void,
      ): void;
    };
  };
}

/**
 * "Guardar en Stash" on any link. The page behind the link is not open, so the click becomes a
 * save-link message with its address only, handled like one sent by the popup; the service then
 * extracts the page through the proxy.
 */
export function registerSaveLinkMenu(
  api: MenuApi,
  dispatch: (message: Message) => Promise<MessageResponse>,
) {
  api.runtime.onInstalled.addListener(() => {
    // Updates keep the menus of the previous version: start clean to avoid a duplicate id.
    void api.contextMenus.removeAll().then(() =>
      api.contextMenus.create({
        id: SAVE_LINK_MENU_ID,
        title: 'Guardar en Stash',
        contexts: ['link'],
      }),
    );
  });
  api.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId !== SAVE_LINK_MENU_ID) return;
    const message = parseMessage({ type: 'save-link', url: info.linkUrl });
    if (message) void dispatch(message);
  });
}
