import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { registerSaveLinkMenu } from '../lib/contextMenu';
import { createMessageHandler, listenToMessages } from '../lib/router';
import { createBackgroundActions } from '../lib/services';

export default defineBackground(() => {
  // Listeners are added synchronously so the browser can wake the background for them.
  const handle = createMessageHandler(createBackgroundActions());
  listenToMessages(browser, handle);
  registerSaveLinkMenu(browser, handle);
});
