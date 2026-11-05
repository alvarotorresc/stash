import { createRawSnippet } from 'svelte';

/** Plain text as a snippet, for components that take children. */
export const text = (value: string) =>
  createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));
