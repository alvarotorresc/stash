import { mount } from 'svelte';
import '@stash/ui/styles.css';
import App from './App.svelte';
import { browser } from 'wxt/browser';
import { createPopupService } from '../../lib/services';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app element');
}

// The real client for the popup is built in lib/services.
mount(App, {
  target,
  props: { service: createPopupService(browser), onclose: () => window.close() },
});
