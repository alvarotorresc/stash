import type { PasswordStrength } from '@stash/ui';
import {
  AccountError,
  ChangeError,
  type Category,
  type Classification,
  type Item,
  type ItemDetail,
  type SearchFilters,
  type SearchResult,
  type Session,
  type Source,
  type StashService,
  type Status,
  type TagInfo,
} from '../service';
import { SEED_ACCOUNT, SEED_CATEGORIES, seedItems } from './seed';

/**
 * In-memory StashService with example data. Nothing leaves the page and
 * nothing is encrypted: it exists so the screens can be built and tested
 * before the real client.
 */

const DAY = 86_400_000;
const MIN_PASSWORD = 10;
const COMMON_PASSWORDS = new Set([
  '1234567890',
  '0123456789',
  'contraseña',
  'contraseña1',
  'password123',
  'qwertyuiop',
  'asdfghjklñ',
  'iloveyou123',
  'aaaaaaaaaa',
]);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface MockOptions {
  /** Start with the session remembered on this device. */
  signedIn?: boolean;
  /** Delay of every call, to see the loading states. */
  latency?: number;
  /** Fixed clock for tests. */
  now?: () => number;
  /** Connection, by default the browser's. */
  online?: boolean;
}

interface Account {
  email: string;
  password: string;
  recoveryCode: string;
}

const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const plainText = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function sourceOf(url: URL): Source {
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host.endsWith('reddit.com')) return 'reddit';
  if (host.endsWith('instagram.com')) return 'instagram';
  return 'web';
}

function originOf(url: URL, source: Source): string {
  const parts = url.pathname.split('/').filter(Boolean);
  if (source === 'reddit' && parts[0] === 'r' && parts[1]) return `r/${parts[1]}`;
  if (source === 'x' && parts[0]) return `@${parts[0]}`;
  return url.hostname.replace(/^www\./, '');
}

export function createMockService(options: MockOptions = {}): StashService {
  const now = options.now ?? (() => Date.now());
  const latency = options.latency ?? 0;
  const listeners = new Set<() => void>();

  let items: ItemDetail[] = seedItems(now());
  let categories = SEED_CATEGORIES.map((category) => ({ ...category }));
  let accounts: Account[] = [{ ...SEED_ACCOUNT, recoveryCode: 'K7QF2M9XWD4R8HTNC3PV6YJBQ5LA' }];
  let session: Session | null =
    (options.signedIn ?? true)
      ? { email: SEED_ACCOUNT.email, rememberedUntil: new Date(now() + 30 * DAY) }
      : null;
  let remembered: string | null = session?.email ?? null;
  let online = options.online ?? (typeof navigator === 'undefined' ? true : navigator.onLine);
  let nextId = 1;

  const notify = () => listeners.forEach((listener) => listener());
  const wait = () =>
    latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve();

  function requireOnline() {
    if (!online) throw new AccountError('offline');
  }

  /** Changes to the data need the network, as with the real service. */
  function requireConnection() {
    if (!online) throw new ChangeError('offline');
  }

  function find(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown item ${id}`);
    return item;
  }

  function summary(detail: ItemDetail): Item {
    const { content, ...item } = detail;
    void content;
    return { ...item, tags: [...item.tags] };
  }

  function signIn(email: string) {
    session = { email, rememberedUntil: new Date(now() + 30 * DAY) };
    remembered = email;
  }

  function strength(password: string): PasswordStrength | null {
    if (!password) return null;
    if (COMMON_PASSWORDS.has(password.toLowerCase())) {
      return { level: 0, blocked: true, message: 'Muy común: elige otra' };
    }
    if (password.length < MIN_PASSWORD) {
      return { level: 1, blocked: false, message: `Mínimo ${MIN_PASSWORD} caracteres` };
    }
    if (password.length < 14) return { level: 2, blocked: false, message: 'Aceptable' };
    if (password.length < 18) return { level: 3, blocked: false, message: 'Buena' };
    return { level: 4, blocked: false, message: 'Muy buena' };
  }

  function acceptable(password: string) {
    const result = strength(password);
    return password.length >= MIN_PASSWORD && !!result && !result.blocked;
  }

  function newRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(28));
    return [...bytes].map((byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
  }

  /** Uploading the queue: the link gets a source and a readable title. */
  function flushQueue() {
    for (const item of items) {
      if (!item.queued) continue;
      item.queued = false;
      item.content = {
        kind: 'preview',
        description: 'Vista previa de la página guardada.',
        blocked: false,
      };
    }
  }

  function setOnline(value: boolean) {
    if (online === value) return;
    online = value;
    if (online) flushQueue();
    notify();
  }

  if (typeof window !== 'undefined' && options.online === undefined) {
    window.addEventListener('online', () => setOnline(true));
    window.addEventListener('offline', () => setOnline(false));
  }

  function snippetAround(text: string, at: number, length: number) {
    const start = Math.max(0, at - 30);
    const end = Math.min(text.length, at + length + 60);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
  }

  function bodyOf(item: ItemDetail) {
    const content = item.content;
    if (content.kind === 'preview') return content.description ?? '';
    if (content.kind === 'none') return '';
    return plainText(content.html);
  }

  return {
    async getSession() {
      await wait();
      return session ? { ...session } : null;
    },

    lastEmail: () => remembered,

    passwordStrength: strength,

    async register(email, password) {
      await wait();
      requireOnline();
      const normalized = email.trim().toLowerCase();
      if (!acceptable(password)) throw new AccountError('weak-password');
      if (accounts.some((account) => account.email === normalized)) {
        throw new AccountError('email-taken');
      }
      const recoveryCode = newRecoveryCode();
      accounts.push({ email: normalized, password, recoveryCode });
      signIn(normalized);
      notify();
      return { recoveryCode };
    },

    async login(email, password) {
      await wait();
      requireOnline();
      const normalized = email.trim().toLowerCase();
      const account = accounts.find((candidate) => candidate.email === normalized);
      if (!account || account.password !== password) {
        throw new AccountError('invalid-credentials');
      }
      signIn(normalized);
      notify();
    },

    async recover(email, recoveryCode, newPassword) {
      await wait();
      requireOnline();
      const normalized = email.trim().toLowerCase();
      const code = recoveryCode.replace(/\s+/g, '').toUpperCase();
      const account = accounts.find((candidate) => candidate.email === normalized);
      if (!account || account.recoveryCode !== code) throw new AccountError('invalid-code');
      if (!acceptable(newPassword)) throw new AccountError('weak-password');
      account.password = newPassword;
      account.recoveryCode = newRecoveryCode();
      signIn(normalized);
      notify();
      return { recoveryCode: account.recoveryCode };
    },

    async changePassword(currentPassword, newPassword) {
      await wait();
      requireOnline();
      const account = accounts.find((candidate) => candidate.email === session?.email);
      if (!account || account.password !== currentPassword) {
        throw new AccountError('wrong-password');
      }
      if (!acceptable(newPassword)) throw new AccountError('weak-password');
      account.password = newPassword;
    },

    async logout() {
      await wait();
      session = null;
      notify();
    },

    async deleteAccount(password) {
      await wait();
      requireOnline();
      const account = accounts.find((candidate) => candidate.email === session?.email);
      if (!account || account.password !== password) throw new AccountError('wrong-password');
      accounts = accounts.filter((candidate) => candidate !== account);
      items = [];
      categories = [];
      session = null;
      remembered = null;
      notify();
    },

    async listItems() {
      await wait();
      return items.map(summary);
    },

    async getItem(id) {
      await wait();
      const item = items.find((candidate) => candidate.id === id);
      return item ? structuredClone(item) : null;
    },

    async save(rawUrl) {
      await wait();
      const url = new URL(rawUrl);
      const existing = items.find((item) => item.url === url.href);
      if (existing) return { ...summary(existing), alreadySaved: true };
      const source = sourceOf(url);
      const display = `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '');
      const item: ItemDetail = {
        id: `item-new-${nextId++}`,
        url: url.href,
        title: display,
        source,
        origin: originOf(url, source),
        priority: null,
        categoryId: null,
        tags: [],
        status: 'pending',
        savedAt: now(),
        queued: !online,
        thumbnail: { tone: ((nextId % 4) + 1) as 1 | 2 | 3 | 4 },
        content: online
          ? { kind: 'preview', description: 'Vista previa de la página guardada.', blocked: false }
          : { kind: 'none' },
      };
      items = [item, ...items];
      notify();
      return { ...summary(item), alreadySaved: false };
    },

    async classify(id, change: Classification) {
      await wait();
      requireConnection();
      const item = find(id);
      if (change.priority !== undefined) item.priority = change.priority;
      if (change.categoryId !== undefined) item.categoryId = change.categoryId;
      if (change.tags !== undefined) item.tags = [...new Set(change.tags)];
      notify();
    },

    async setStatus(id, status: Status) {
      await wait();
      requireConnection();
      const item = find(id);
      const before = item.status;
      item.status = status;
      notify();
      return async () => {
        await wait();
        requireConnection();
        find(id).status = before;
        notify();
      };
    },

    async search(filters: SearchFilters) {
      await wait();
      const query = fold(filters.query.trim());
      const results: SearchResult[] = [];
      for (const item of items) {
        if (filters.status !== 'all' && item.status !== filters.status) continue;
        if (filters.source !== 'all' && item.source !== filters.source) continue;
        if (filters.priority !== 'all' && item.priority !== filters.priority) continue;
        if (filters.category === 'none' && item.categoryId !== null) continue;
        if (
          filters.category !== 'all' &&
          filters.category !== 'none' &&
          item.categoryId !== filters.category
        ) {
          continue;
        }
        if (!query) {
          results.push({ item: summary(item) });
          continue;
        }
        if (fold(item.title).includes(query)) {
          results.push({ item: summary(item) });
          continue;
        }
        const body = bodyOf(item);
        const at = fold(body).indexOf(query);
        if (at !== -1) {
          results.push({ item: summary(item), snippet: snippetAround(body, at, query.length) });
        }
      }
      return results.sort((a, b) => b.item.savedAt - a.item.savedAt);
    },

    async listCategories() {
      await wait();
      return categories.map((category): Category => ({
        ...category,
        count: items.filter((item) => item.categoryId === category.id).length,
      }));
    },

    async createCategory(name) {
      await wait();
      requireConnection();
      const trimmed = name.trim();
      const existing = categories.find((category) => fold(category.name) === fold(trimmed));
      if (existing) return { ...existing, count: 0 };
      const category = { id: `cat-new-${nextId++}`, name: trimmed };
      categories = [...categories, category];
      notify();
      return { ...category, count: 0 };
    },

    async renameCategory(id, name) {
      await wait();
      requireConnection();
      categories = categories.map((category) =>
        category.id === id ? { ...category, name: name.trim() } : category,
      );
      notify();
    },

    async deleteCategory(id) {
      await wait();
      requireConnection();
      categories = categories.filter((category) => category.id !== id);
      for (const item of items) if (item.categoryId === id) item.categoryId = null;
      notify();
    },

    async reorderCategories(ids) {
      await wait();
      requireConnection();
      const byId = new Map(categories.map((category) => [category.id, category]));
      categories = ids.map((id) => byId.get(id)).filter((category) => category !== undefined);
      notify();
    },

    async listTags() {
      await wait();
      const counts = new Map<string, number>();
      for (const item of items) {
        for (const tag of item.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts]
        .map(([name, count]): TagInfo => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },

    async renameTag(name, newName) {
      await wait();
      requireConnection();
      const target = newName.trim();
      for (const item of items) {
        if (item.tags.includes(name)) {
          item.tags = [...new Set(item.tags.map((tag) => (tag === name ? target : tag)))];
        }
      }
      notify();
    },

    async deleteTag(name) {
      await wait();
      requireConnection();
      for (const item of items) item.tags = item.tags.filter((tag) => tag !== name);
      notify();
    },

    async exportAll() {
      await wait();
      const data = { items, categories, exportedAt: new Date(now()).toISOString() };
      return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    },

    isOnline: () => online,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
