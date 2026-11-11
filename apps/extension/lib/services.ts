import type { Stash } from '@stash/client';
import { createExtensionStash, API_ORIGIN } from './client';
import { createPopupService as createRealPopupService } from './popupService';
import { toHttpUrl, type PopupService } from './service';
import type { BackgroundActions } from './router';
import { createPendingLinks, type PendingLinks, type StorageArea } from './storage';
import type { TabApi } from './tab';

/**
 * The one place where the extension builds its Stash services. The popup and the background run
 * in separate contexts and each creates its own client: they share the session in `storage.local`
 * and the data key and encrypted cache in the extension's IndexedDB, not memory.
 */

/** The parts of the extension API the services use, so tests can pass a fake. */
export interface ServicesApi extends TabApi {
  storage: { local: StorageArea };
  permissions: { request(permissions: { origins: string[] }): Promise<boolean> };
  action: { setBadgeText(details: { text: string }): Promise<void> | void };
}

/** Links waiting for an unlocked session, with their count on the toolbar button. */
export function createBadgedPendingLinks(
  area: StorageArea,
  setBadge: (text: string) => Promise<void> | void,
): PendingLinks {
  const links = createPendingLinks(area, (value) => toHttpUrl(value) !== null);
  const show = async () => {
    const { length } = await links.list();
    await setBadge(length > 0 ? String(length) : '');
  };
  return {
    list: links.list,
    async add(url) {
      const count = await links.add(url);
      await show();
      return count;
    },
    async remove(url) {
      await links.remove(url);
      await show();
    },
    async clear() {
      await links.clear();
      await show();
    },
  };
}

/** Service for the popup, which has a DOM: it reads pages and runs the key derivation. */
export function createPopupService(api: ServicesApi): PopupService {
  const area = api.storage.local;
  return createRealPopupService({
    stash: createExtensionStash({ area, readPages: true }),
    tabApi: api,
    pending: createBadgedPendingLinks(area, (text) => api.action.setBadgeText({ text })),
    requestHostAccess: () => api.permissions.request({ origins: [`${API_ORIGIN}/*`] }),
  });
}

export interface BackgroundDeps {
  pending: PendingLinks;
  /** A fresh client per call; see `createBackgroundActions`. */
  createStash: () => Stash;
}

/**
 * What the background does with the save messages. The background has no DOM, so the link is
 * saved as it is and the proxy reads it later, when the popup opens. Without an unlocked
 * session (never logged in, expired, logged out) or if saving fails, the link waits in
 * `storage.local` and the popup saves it once unlocked: it is never dropped.
 *
 * Each call makes its own client: the data key is read from IndexedDB every time, so a logout
 * from the popup takes effect here at once instead of the background holding a stale key.
 */
export function createBackgroundActions({
  pending,
  createStash,
}: BackgroundDeps): BackgroundActions {
  return {
    async saveLink(url) {
      const stash = createStash();
      try {
        if (await stash.session()) {
          await stash.save(url);
          return;
        }
      } catch {
        // Falls through to the waiting list below.
      } finally {
        stash.dispose();
      }
      await pending.add(url);
    },
  };
}

export function createExtensionBackgroundActions(api: ServicesApi): BackgroundActions {
  const area = api.storage.local;
  return createBackgroundActions({
    pending: createBadgedPendingLinks(area, (text) => api.action.setBadgeText({ text })),
    createStash: () => createExtensionStash({ area, readPages: false }),
  });
}
