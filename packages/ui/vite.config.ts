import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

// Serves and builds the component catalog (catalog/), a review page for the kit.
export default defineConfig({
  root: 'catalog',
  plugins: [svelte()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
