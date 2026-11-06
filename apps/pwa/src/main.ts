import { mount } from 'svelte';
import '@stash/ui/styles.css';
import App from './App.svelte';
import { AppState } from './lib/app.svelte';
import { createMockService } from './lib/mock/mockService';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app element');
}

// Until the real client exists, the app runs on example data in memory.
// In development, ?lento adds latency to see the loading states.
const slow = import.meta.env.DEV && new URLSearchParams(location.search).has('lento');
const app = new AppState(createMockService({ latency: slow ? 1200 : 0 }));

mount(App, { target, props: { app } });
