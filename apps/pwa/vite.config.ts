import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  // In development the API runs apart (`pnpm --filter @stash/api dev`); in
  // production the same Worker serves the app and /api on one origin.
  server: { proxy: { '/api': 'http://localhost:8787' } },
  plugins: [
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The self-hosted fonts too, so the app looks the same offline.
      injectManifest: { globPatterns: ['**/*.{js,css,html,woff2}'] },
      manifest: {
        name: 'Stash',
        short_name: 'Stash',
        description: 'One ordered drawer for everything you save for later.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'es',
        background_color: '#eef0ea',
        theme_color: '#eef0ea',
        // Chrome on Android needs PNG icons at 192 and 512 to install the app,
        // and the share sheet only lists installed apps.
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Android share sheet: the service worker answers this POST (src/share.ts).
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { title: 'title', text: 'text', url: 'url' },
        },
      },
    }),
  ],
});
