import { defineConfig } from 'wxt';

/** The repository root, with a trailing slash. */
const REPO_ROOT = decodeURIComponent(new URL('../../', import.meta.url).pathname);

/** The only host the extension talks to: the Stash API. */
const API_HOST = 'https://stash.alvarotc.com/*';

export default defineConfig({
  modules: ['@wxt-dev/module-svelte'],
  svelte: {
    vite: {
      compilerOptions: {
        // Scoped class names hash the file path. Svelte makes it relative only to this folder, so
        // components from packages/ui kept their absolute path: relative to the repository, a
        // build from the sources zip matches the published one byte for byte.
        rootDir: REPO_ROOT,
      },
    },
  },
  // Firefox defaults to MV2 in WXT: both browsers ship Manifest V3.
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'Stash',
    description: 'One ordered drawer for everything you save for later.',
    // activeTab: read the open tab only when the popup is opened (the user's click grants it).
    // scripting: inject the one function that reads that tab; MV3 has no other way.
    // contextMenus: "Guardar en Stash" on links. storage: the session token and the links waiting
    // for it.
    // No <all_urls> and no content scripts: a link saved from the menu goes through the proxy.
    permissions: ['activeTab', 'scripting', 'contextMenus', 'storage'],
    host_permissions: [API_HOST],
    // Declared on both browsers: WebAssembly (key derivation in the popup) needs
    // 'wasm-unsafe-eval', and Firefox may not include it by default.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          // AMO does not assign ids to MV3 add-ons; signing needs a fixed one.
          id: 'stash@alvarotc.com',
          // First release with the built-in data consent below.
          strict_min_version: '140.0',
          // Saved links (browsing activity) and the content of saved pages leave the device,
          // end-to-end encrypted, to sync; links saved from the menu go through the proxy.
          data_collection_permissions: { required: ['browsingActivity', 'websiteContent'] },
        },
      },
    }),
  }),
  zip: {
    // The extension is built from a pnpm workspace, so the sources zip starts at the repository
    // root with an allowlist: only what AMO needs to rebuild it, never local notes or secrets.
    sourcesRoot: '../..',
    includeSources: [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'tsconfig.base.json',
      'LICENSE',
      'apps/extension/**',
      'packages/client/**',
      'packages/core/**',
      'packages/reader/**',
      'packages/ui/**',
    ],
    excludeSources: [
      '**/coverage/**',
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/node_modules/**',
    ],
  },
});
