/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { SHARE_PATH, handleShareRequest } from './share';

declare let self: ServiceWorkerGlobalScope;

// Before precaching: the share target is a POST that only this handler answers.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === SHARE_PATH) {
    event.respondWith(handleShareRequest(event.request, self.location.origin));
  }
});

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
