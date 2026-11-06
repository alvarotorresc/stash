import type { PasswordStrength } from '@stash/ui';
import { AccountError, type Page, type PopupService, type SavedItem } from './service';

/** In-memory popup service with example data. Nothing leaves the extension. */

export interface MockPopupOptions {
  signedIn?: boolean;
  /** The page in the active tab. */
  tab?: Page | null;
  latency?: number;
}

const ACCOUNT = { email: 'maria@ejemplo.com', password: 'calabaza-asada-2026' };
const COMMON = new Set(['1234567890', 'password123', 'qwertyuiop', 'contraseña']);
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const EXAMPLE_TAB: Page = {
  url: 'https://lacocinaordenada.es/organizar-la-despensa',
  title: 'Cómo organizar la despensa para no tirar comida',
};

export function createMockPopupService(options: MockPopupOptions = {}): PopupService {
  const latency = options.latency ?? 0;
  const accounts = [{ ...ACCOUNT }];
  let session: { email: string } | null =
    (options.signedIn ?? true) ? { email: ACCOUNT.email } : null;
  const tab = options.tab === undefined ? EXAMPLE_TAB : options.tab;
  const items: SavedItem[] = [];
  const categories = [
    { id: 'cat-trabajo', name: 'Trabajo' },
    { id: 'cat-casa', name: 'Casa' },
    { id: 'cat-recetas', name: 'Recetas' },
    { id: 'cat-madrid', name: 'Madrid' },
  ];
  const tags = [
    { name: 'cena', count: 6 },
    { name: 'otoño', count: 4 },
    { name: 'orden', count: 3 },
    { name: 'atajos', count: 3 },
    { name: 'despensa', count: 1 },
  ];

  const wait = () =>
    latency > 0 ? new Promise<void>((resolve) => setTimeout(resolve, latency)) : Promise.resolve();

  function strength(password: string): PasswordStrength | null {
    if (!password) return null;
    if (COMMON.has(password.toLowerCase())) {
      return { level: 0, blocked: true, message: 'Muy común: elige otra' };
    }
    if (password.length < 10) return { level: 1, blocked: false, message: 'Mínimo 10 caracteres' };
    if (password.length < 14) return { level: 2, blocked: false, message: 'Aceptable' };
    if (password.length < 18) return { level: 3, blocked: false, message: 'Buena' };
    return { level: 4, blocked: false, message: 'Muy buena' };
  }

  return {
    async getSession() {
      await wait();
      return session;
    },
    lastEmail: () => session?.email ?? null,
    passwordStrength: strength,
    async login(email, password) {
      await wait();
      const account = accounts.find((a) => a.email === email.trim().toLowerCase());
      if (!account || account.password !== password) {
        throw new AccountError('invalid-credentials');
      }
      session = { email: account.email };
    },
    async register(email, password) {
      await wait();
      const normalized = email.trim().toLowerCase();
      const result = strength(password);
      if (password.length < 10 || !result || result.blocked) {
        throw new AccountError('weak-password');
      }
      if (accounts.some((a) => a.email === normalized)) throw new AccountError('email-taken');
      accounts.push({ email: normalized, password });
      session = { email: normalized };
      const bytes = crypto.getRandomValues(new Uint8Array(28));
      return {
        recoveryCode: [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join(''),
      };
    },
    async currentTab() {
      await wait();
      return tab;
    },
    async save(page) {
      await wait();
      const existing = items.find((item) => item.url === page.url);
      if (existing) return { ...existing };
      const url = new URL(page.url);
      const item: SavedItem = {
        id: `item-${items.length + 1}`,
        url: url.href,
        title: page.title.trim() || url.href,
        domain: url.hostname.replace(/^www\./, ''),
        priority: null,
        categoryId: null,
        tags: [],
        thumbnail: { tone: 1 },
      };
      items.push(item);
      return { ...item };
    },
    async classify(id, change) {
      await wait();
      const item = items.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown item ${id}`);
      if (change.priority !== undefined) item.priority = change.priority;
      if (change.categoryId !== undefined) item.categoryId = change.categoryId;
      if (change.tags !== undefined) item.tags = [...change.tags];
    },
    async listCategories() {
      await wait();
      return categories.map((category) => ({ ...category }));
    },
    async listTags() {
      await wait();
      return tags.map((tag) => ({ ...tag }));
    },
  };
}
