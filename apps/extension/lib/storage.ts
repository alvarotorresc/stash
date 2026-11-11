import type { SessionStore, StoredSession } from '@stash/core';

/**
 * The part of `storage.local` the extension uses, so tests can pass an in-memory area. Every
 * value read from it is untrusted until a check below accepts it.
 */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const SESSION_KEY = 'stash-session';
export const PENDING_KEY = 'stash-pending-links';

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const { token, expiresAt, email } = value as Record<string, unknown>;
  return (
    typeof token === 'string' &&
    typeof email === 'string' &&
    typeof expiresAt === 'number' &&
    Number.isFinite(expiresAt)
  );
}

/**
 * The session in the extension's own storage: only its pages and its background can read it
 * (web pages and other extensions cannot). A record that does not look like a session is
 * deleted when read, so a corrupted one fails closed into "log in again".
 */
export function createStorageSessionStore(area: StorageArea): SessionStore {
  return {
    async load() {
      const value = (await area.get(SESSION_KEY))[SESSION_KEY];
      if (value === undefined) return null;
      if (isStoredSession(value)) {
        return { token: value.token, expiresAt: value.expiresAt, email: value.email };
      }
      await area.remove(SESSION_KEY);
      return null;
    },
    async save(session) {
      await area.set({
        [SESSION_KEY]: { token: session.token, expiresAt: session.expiresAt, email: session.email },
      });
    },
    async clear() {
      await area.remove(SESSION_KEY);
    },
  };
}

/** Most links kept while there is no session to save them with. */
export const MAX_PENDING_LINKS = 50;

/**
 * Links chosen from the context menu while no unlocked session could save them. They wait here,
 * as plain addresses (there is no key to encrypt them with yet), until the popup is unlocked and
 * saves them. Capped, deduplicated and http(s) only; whatever else is in storage is ignored.
 */
export interface PendingLinks {
  list(): Promise<string[]>;
  /** Adds a link; returns how many are waiting now. */
  add(url: string): Promise<number>;
  remove(url: string): Promise<void>;
  clear(): Promise<void>;
}

export function createPendingLinks(
  area: StorageArea,
  isLink: (value: string) => boolean,
): PendingLinks {
  async function read(): Promise<string[]> {
    const value = (await area.get(PENDING_KEY))[PENDING_KEY];
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === 'string' && isLink(entry));
  }

  return {
    list: read,
    async add(url) {
      const links = await read();
      if (links.includes(url)) return links.length;
      const next = [...links, url].slice(-MAX_PENDING_LINKS);
      await area.set({ [PENDING_KEY]: next });
      return next.length;
    },
    async remove(url) {
      const links = await read();
      const next = links.filter((link) => link !== url);
      if (next.length === 0) await area.remove(PENDING_KEY);
      else await area.set({ [PENDING_KEY]: next });
    },
    async clear() {
      await area.remove(PENDING_KEY);
    },
  };
}
