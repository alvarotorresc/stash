import { render, screen, waitFor } from '@testing-library/svelte';
import { expect } from 'vitest';
import App from './App.svelte';
import { AppState } from './lib/app.svelte';
import { createMockService, type MockOptions } from './lib/mock/mockService';

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
