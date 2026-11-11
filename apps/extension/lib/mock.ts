import type { SanitizedHtml } from '@stash/ui';
import {
  AccountError,
  type ItemDetail,
  type Page,
  type PopupService,
  type SavedItem,
} from './service';

/** In-memory popup service with example data. Nothing leaves the extension. */

export interface MockPopupOptions {
  signedIn?: boolean;
  /** Links picked from the context menu while signed out. */
  pendingLinks?: string[];
  /** The page in the active tab. */
  tab?: Page | null;
  latency?: number;
}

const ACCOUNT = { email: 'maria@ejemplo.com', password: 'calabaza-asada-2026' };

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
  const pendingLinks = [...(options.pendingLinks ?? [])];
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

  const service: PopupService = {
    async getSession() {
      await wait();
      return session;
    },
    lastEmail: () => session?.email ?? null,
    async login(email, password) {
      await wait();
      const account = accounts.find((a) => a.email === email.trim().toLowerCase());
      if (!account || account.password !== password) {
        throw new AccountError('invalid-credentials');
      }
      session = { email: account.email };
    },
    async logout() {
      await wait();
      session = null;
      pendingLinks.length = 0;
    },
    async savePendingLinks() {
      await wait();
      const count = pendingLinks.length;
      for (const url of pendingLinks.splice(0)) await service.save({ url, title: url });
      return count;
    },
    async currentTab() {
      await wait();
      return tab;
    },
    async save(page) {
      await wait();
      const existing = items.find((item) => item.url === page.url);
      if (existing) return { ...existing, alreadySaved: true };
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
      return { ...item, alreadySaved: false };
    },
    async classify(id, change) {
      await wait();
      const item = items.find((candidate) => candidate.id === id);
      if (!item) throw new Error(`Unknown item ${id}`);
      if (change.priority !== undefined) item.priority = change.priority;
      if (change.categoryId !== undefined) item.categoryId = change.categoryId;
      if (change.tags !== undefined) item.tags = [...change.tags];
    },
    async listItems() {
      await wait();
      return items.map((item) => ({
        id: item.id,
        title: item.title,
        origin: item.domain,
        queued: false,
        thumbnail: item.thumbnail,
      }));
    },
    async getItem(id): Promise<ItemDetail | null> {
      await wait();
      const item = items.find((candidate) => candidate.id === id);
      if (!item) return null;
      return {
        id: item.id,
        title: item.title,
        origin: item.domain,
        queued: false,
        thumbnail: item.thumbnail,
        url: item.url,
        content: {
          kind: 'article',
          meta: `${item.domain} · 1 min`,
          html: '<p>Texto de ejemplo del artículo.</p>' as SanitizedHtml,
        },
      };
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
  return service;
}
