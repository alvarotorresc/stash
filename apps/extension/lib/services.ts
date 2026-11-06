import { createMockPopupService } from './mock';
import type { BackgroundActions } from './router';
import type { PopupService } from './service';
import { readActiveTab, type TabApi } from './tab';

/**
 * The one place where the extension picks its Stash service. Today it is the in-memory example
 * service; when accounts and sync arrive, the real client is created here and both the popup and
 * the background get it without other changes.
 *
 * The popup and the background run in separate contexts, so each one creates its own service.
 * With the mock they do not share state: a link saved from the menu does not appear in the popup.
 */

/** Service for the popup. Reading the open tab is real; the rest is the mock for now. */
export function createPopupService(api: TabApi): PopupService {
  return { ...createMockPopupService(), currentTab: () => readActiveTab(api) };
}

/** What the background does with the save messages. */
export function createBackgroundActions(): BackgroundActions {
  const service = createMockPopupService();
  // A link whose page is not open: the real service extracts it through the proxy.
  return { saveLink: (url) => service.save({ url, title: url }) };
}
