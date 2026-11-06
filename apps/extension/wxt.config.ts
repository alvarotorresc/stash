import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  // Firefox defaults to MV2 in WXT: both browsers ship Manifest V3.
  manifestVersion: 3,
  manifest: {
    name: 'Stash',
    description: 'One ordered drawer for everything you save for later.',
    // contextMenus: "Guardar en Stash" on links. activeTab: read the open tab only when
    // the popup is opened. No host permissions.
    permissions: ['contextMenus', 'activeTab'],
  },
});
