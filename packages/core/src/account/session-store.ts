/**
 * The session as the device keeps it: the bearer token, when it expires and the email it was
 * opened with. Never the password.
 */
export interface StoredSession {
  readonly token: string;
  readonly expiresAt: number;
  readonly email: string;
}

/** Where the session lives. Asynchronous so an extension can back it with its own storage. */
export interface SessionStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

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

/** Keeps the session in memory only; it is gone when the page closes. */
export function createMemorySessionStore(): SessionStore {
  let current: StoredSession | null = null;
  return {
    async load() {
      return current;
    },
    async save(session) {
      current = { ...session };
    },
    async clear() {
      current = null;
    },
  };
}

/**
 * Keeps the session in a Web Storage area such as `localStorage`. A record that does not look
 * like a session is deleted when read.
 */
export function createWebStorageSessionStore(
  storage: Storage,
  key = 'stash-session',
): SessionStore {
  return {
    async load() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      if (isStoredSession(parsed)) return parsed;
      storage.removeItem(key);
      return null;
    },
    async save(session) {
      storage.setItem(key, JSON.stringify(session));
    },
    async clear() {
      storage.removeItem(key);
    },
  };
}
