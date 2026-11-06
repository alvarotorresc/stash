import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    include: ['entrypoints/**/*.test.ts', 'lib/**/*.test.ts'],
    setupFiles: ['test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['entrypoints/**/*.{ts,svelte}', 'lib/**/*.ts'],
      // Entry point bootstraps run only inside the browser.
      exclude: [
        '**/*.test.ts',
        'entrypoints/**/main.ts',
        // Thin wrapper: the menu logic it calls is tested in lib/contextMenu.
        'entrypoints/background.ts',
      ],
      thresholds: { lines: 85, functions: 85, branches: 85, statements: 85 },
    },
  },
});
