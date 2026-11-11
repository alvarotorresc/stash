import { createStash, type Stash, type StashOptions } from '@stash/client';
import { createStorageSessionStore, type StorageArea } from './storage';

/** The only server the extension talks to (also the only host permission). */
export const API_ORIGIN = 'https://stash.alvarotc.com';

/**
 * Requests never carry cookies: the API authenticates with the Bearer token only, so there is
 * nothing a cross-site request could ride on. The arrow also keeps `fetch` bound to the global
 * scope, which a service worker requires.
 */
export const fetchWithoutCookies: typeof fetch = (input, init) =>
  fetch(input, { ...init, credentials: 'omit' });

export interface ExtensionStashOptions extends Pick<
  StashOptions,
  'dataKeyStore' | 'cache' | 'isOnline'
> {
  /** `storage.local` of the extension. */
  area: StorageArea;
  /** Whether this context has a DOM to read pages with (the popup does, the background not). */
  readPages: boolean;
  fetch?: typeof fetch;
  baseUrl?: string;
}

/**
 * The real client for an extension context. The session token lives in `storage.local`; the
 * remembered data key is the client's default: a non-extractable key in the extension's own
 * IndexedDB, valid 30 days from the last password entry.
 */
export function createExtensionStash(options: ExtensionStashOptions): Stash {
  return createStash({
    baseUrl: options.baseUrl ?? API_ORIGIN,
    fetch: options.fetch ?? fetchWithoutCookies,
    sessionStore: createStorageSessionStore(options.area),
    readPages: options.readPages,
    // Defaults: the extension's own IndexedDB (data key for 30 days, encrypted cache).
    ...(options.dataKeyStore && { dataKeyStore: options.dataKeyStore }),
    ...(options.cache && { cache: options.cache }),
    ...(options.isOnline && { isOnline: options.isOnline }),
    // No window events in a service worker; the popup is short-lived and syncs when it opens.
    events: null,
  });
}
