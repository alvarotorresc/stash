/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { SHARE_PARAM, handleShareRequest, isShareRequest } from './share';

declare let self: ServiceWorkerGlobalScope;

// Before precaching: the share target is a POST that only this handler answers.
self.addEventListener('fetch', (event) => {
  if (isShareRequest(event.request, self.location.origin)) {
    event.respondWith(handleShareRequest(event.request, self.location.origin));
  }
});

cleanupOutdatedCaches();
// The 303 lands on /?share=<link>. Ignoring that parameter serves the cached
// app shell, so the shared link never reaches the server and sharing works
// offline too.
precacheAndRoute(self.__WB_MANIFEST, {
  ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, new RegExp(`^${SHARE_PARAM}$`)],
});
