import { mount } from 'svelte';
import { createStash } from '@stash/client';
import { createWebStorageSessionStore } from '@stash/core';
import '@stash/ui/styles.css';
import App from './App.svelte';
import { AppState } from './lib/app.svelte';
import { createRealService } from './lib/real/realService';
import type { StashService } from './lib/service';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app element');
}

/**
 * The real service always, except in development with VITE_STASH_MOCK=1, which runs
 * on example data in memory (add ?lento to slow it down). Production builds drop the
 * mock entirely: `import.meta.env.DEV` is false there.
 */
async function createService(): Promise<StashService> {
  if (import.meta.env.DEV && import.meta.env.VITE_STASH_MOCK === '1') {
    const { createMockService } = await import('./lib/mock/mockService');
    const slow = new URLSearchParams(location.search).has('lento');
    return createMockService({ latency: slow ? 1200 : 0 });
  }
  // The session token lives in localStorage, protected by the strict CSP in
  // public/_headers; the data key stays a non-extractable key (see @stash/core).
  const stash = createStash({ sessionStore: createWebStorageSessionStore(localStorage) });
  return createRealService(stash);
}

const app = new AppState(await createService());

mount(App, { target, props: { app } });
