import { createStash, type Stash, type ThumbnailMaker } from '@stash/client';
import { FakeBackend } from '@stash/client/testing';
import { createIndexedDbDataKeyStore, createMemorySessionStore } from '@stash/core';
import { createIndexedDbRecordCache } from '@stash/core/sync';
import { render, screen, waitFor } from '@testing-library/svelte';
import { IDBFactory } from 'fake-indexeddb';
import { expect } from 'vitest';
import App from './App.svelte';
import { AppState } from './lib/app.svelte';
import { createMockService, type MockOptions } from './lib/mock/mockService';
import { createRealService } from './lib/real/realService';

export const NOW = Date.UTC(2026, 10, 5, 10, 0, 0);

/** The whole app on a fresh mock, at the given hash. Waits for the first screen. */
export async function renderApp(
  hash = '#/',
  options: MockOptions = {},
  { waitForData = true } = {},
) {
  history.replaceState(null, '', `/${hash}`);
  const service = createMockService({ online: true, now: () => NOW, ...options });
  const app = new AppState(service);
  const result = render(App, { app });
  await screen.findByRole('heading', { level: 1 });
  if (waitForData) await waitFor(() => expect(!app.session || !app.loading).toBe(true));
  return { ...result, app, service };
}

/** The real client on one device, against the in-memory API. */
export function realDevice(
  backend = new FakeBackend(),
  factory = new IDBFactory(),
  makeThumbnail: ThumbnailMaker | null = null,
) {
  const events = new EventTarget();
  const stash: Stash = createStash({
    baseUrl: 'https://stash.test',
    fetch: backend.fetch,
    sessionStore: createMemorySessionStore(),
    dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
    cache: createIndexedDbRecordCache({ indexedDB: factory }),
    isOnline: () => backend.online,
    events,
    makeThumbnail,
  });
  return { backend, factory, events, stash, service: createRealService(stash) };
}

/** The whole app on the real service (encryption, sync, cache), at the given hash. */
export async function renderRealApp(hash = '#/', device = realDevice()) {
  history.replaceState(null, '', `/${hash}`);
  const app = new AppState(device.service);
  const result = render(App, { app });
  await screen.findByRole('heading', { level: 1 });
  return { ...result, ...device, app };
}
