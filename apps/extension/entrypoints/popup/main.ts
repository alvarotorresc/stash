import { mount } from 'svelte';
import '@stash/ui/styles.css';
import App from './App.svelte';
import { createMockPopupService } from '../../lib/mock';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app element');
}

// Until the real client exists, the popup runs on example data in memory.
mount(App, {
  target,
  props: { service: createMockPopupService(), onclose: () => window.close() },
});
