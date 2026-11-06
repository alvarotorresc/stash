import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
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
