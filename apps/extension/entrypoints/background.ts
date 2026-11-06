import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { registerSaveLinkMenu } from '../lib/contextMenu';
import { createMockPopupService } from '../lib/mock';

export default defineBackground(() => {
  // Until the real client exists, saves go to the in-memory example service.
  const service = createMockPopupService();
  registerSaveLinkMenu(browser, (page) => service.save(page));
});
