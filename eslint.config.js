// @ts-check
import eslint from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    // Local notes outside the repository (symlinks).
    'docs',
    'docs/**',
    'design',
    'design/**',
    '**/dist/',
    '**/dev-dist/',
    '**/.output/',
    '**/.wxt/',
    '**/coverage/',
    '**/.wrangler/',
  ]),
  {
    extends: [eslint.configs.recommended, tseslint.configs.recommended, svelte.configs.recommended],
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  {
    // Tooling configuration runs in Node.js.
    files: ['*.config.{js,ts}', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]);
