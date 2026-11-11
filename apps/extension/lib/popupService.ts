import type { Stash } from '@stash/client';
import { readHtml } from '@stash/client';
import { AccountApiError } from '@stash/core';
import type { ItemView } from '@stash/core/sync';
import { sanitizeStoredHtml } from '@stash/reader';
import type { SanitizedHtml } from '@stash/ui';
import type { PendingLinks } from './storage';
import {
  AccountError,
  toHttpUrl,
  type ItemDetail,
  type ListedItem,
  type PopupService,
  type ReadingContent,
  type SaveResult,
} from './service';
import { readActiveTab, type TabApi } from './tab';

/** Most links the list shows. */
const MAX_LISTED = 30;
const WORDS_PER_MINUTE = 200;

export interface PopupServiceDeps {
  stash: Stash;
  tabApi: TabApi;
  pending: PendingLinks;
  /**
   * Asks for access to the Stash host (a no-op prompt when it is already granted). It is the
   * first thing `login` does, so it runs inside the click that started it: Firefox treats the
   * host permissions of Manifest V3 as optional.
   */
  requestHostAccess: () => Promise<boolean>;
}

/** A failed password entry as the popup names it; anything unexpected passes as is. */
function accountError(failure: unknown): unknown {
  if (!(failure instanceof AccountApiError)) return failure;
  switch (failure.code) {
    case 'INVALID_CREDENTIALS':
      return new AccountError('invalid-credentials');
    case 'RATE_LIMITED':
      return new AccountError('rate-limited');
    case 'NETWORK_ERROR':
      return new AccountError('offline');
    default:
      return failure;
  }
}

const host = (url: string) => {
  const parsed = toHttpUrl(url);
  return parsed ? new URL(parsed).hostname.replace(/^www\./, '') : '';
};

function toListed(view: ItemView): ListedItem {
  return {
    id: view.id,
    title: view.title,
    origin: host(view.url),
    queued: view.queued,
    thumbnail: { tone: 1 },
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * What the reading view shows. The stored HTML goes through the sanitizer right before it
 * reaches the screen, whatever its origin (read here, from the cache or from another device);
 * content kept as text only is escaped, one paragraph per line.
 */
function toContent(view: ItemView): ReadingContent {
  if (view.queued) return { kind: 'none' };
  const { content } = view;
  if (content === null || content.kind === 'none' || !(content.html || content.text.trim())) {
    const description = view.preview?.description;
    return description ? { kind: 'preview', description } : { kind: 'preview' };
  }
  const html =
    content.html ??
    content.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
  const minutes = Math.max(
    1,
    Math.round(content.text.split(/\s+/).filter(Boolean).length / WORDS_PER_MINUTE),
  );
  return {
    kind: 'article',
    meta: `${host(view.url)} · ${minutes} min`,
    html: sanitizeStoredHtml(html, view.url) as SanitizedHtml,
  };
}

/** The popup's service over the real client: accounts, encrypted sync and the open tab's page. */
export function createPopupService(deps: PopupServiceDeps): PopupService {
  const { stash, tabApi, pending, requestHostAccess } = deps;
  let lastEmail: string | null = null;

  /** The decrypted copy is ready once the cache is open. */
  const ready = () => stash.start();

  return {
    async getSession() {
      const session = await stash.session();
      lastEmail = session?.email ?? (await stash.lastEmail());
      if (!session) return null;
      // Opens the encrypted cache, then syncs in the background; a failure shows on the lists.
      await ready().catch(() => {});
      return { email: session.email };
    },

    lastEmail: () => lastEmail,

    async login(email, password) {
      // First, before any await: the permission prompt needs the user's click.
      // A failed request (a browser that refuses to ask for a declared host) is not a refusal:
      // if the access is really missing, the API call below fails and says so.
      const access = requestHostAccess().catch(() => true);
      if (!(await access)) throw new AccountError('no-access');
      try {
        await stash.login({ email, password });
      } catch (failure) {
        throw accountError(failure);
      }
    },

    async logout() {
      await stash.logout();
      await pending.clear();
      lastEmail = null;
    },

    currentTab: () => readActiveTab(tabApi),

    async save(page): Promise<SaveResult> {
      const url = toHttpUrl(page.url);
      if (!url) throw new Error('Only web pages are saved');
      // The tab's HTML is read on the device; without it the proxy reads the link afterwards.
      const saved = await stash.save(url, page.html ? { read: readHtml(page.html, url) } : {});
      return {
        id: saved.id,
        url: saved.url,
        // The page's own title until the link is read.
        title: saved.title === saved.url ? page.title.trim() || saved.title : saved.title,
        domain: host(saved.url),
        priority: saved.priority,
        categoryId: saved.categoryId,
        tags: saved.tags.map((tag) => tag.name),
        thumbnail: { tone: 1 },
        alreadySaved: saved.alreadySaved,
      };
    },

    async savePendingLinks() {
      let saved = 0;
      for (const url of await pending.list()) {
        try {
          await stash.save(url);
        } catch {
          // Offline or the server failed: it stays for the next time the popup opens.
          break;
        }
        await pending.remove(url);
        saved += 1;
      }
      return saved;
    },

    async classify(id, { categoryId, priority, tags }) {
      await stash.change((sync) => sync.classify(id, { categoryId, priority, tags }));
    },

    async listCategories() {
      await ready();
      return stash.sync.listCategories().map(({ id, name }) => ({ id, name }));
    },

    async listTags() {
      await ready();
      return stash.sync.listTags().map(({ name, count }) => ({ name, count }));
    },

    async listItems() {
      await ready();
      return stash.sync
        .listItems()
        .filter((view) => view.status === 'pending')
        .slice(0, MAX_LISTED)
        .map(toListed);
    },

    async getItem(id): Promise<ItemDetail | null> {
      await ready();
      const view = stash.sync.getItem(id);
      const url = view && toHttpUrl(view.url);
      if (!view || !url) return null;
      return { ...toListed(view), url, content: toContent(view) };
    },
  };
}
