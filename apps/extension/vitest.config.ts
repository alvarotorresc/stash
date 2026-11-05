import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    include: ['entrypoints/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['entrypoints/**/*.{ts,svelte}'],
      // Entry point bootstraps run only inside the browser.
      exclude: ['entrypoints/**/*.test.ts', 'entrypoints/**/main.ts'],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
