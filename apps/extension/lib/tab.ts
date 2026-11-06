import { toHttpUrl, type MetaTag, type Page } from './service';

/** Largest HTML read from a tab, in UTF-16 units. Larger pages send only their meta tags. */
export const MAX_HTML_LENGTH = 2 * 1024 * 1024;
/** Most meta tags kept from a page. */
export const MAX_META_TAGS = 64;
/** Longest meta tag key and value kept. */
export const MAX_META_KEY = 100;
export const MAX_META_CONTENT = 1000;
/** Longest title kept. */
export const MAX_TITLE = 500;

/** What the injected script returns. It comes from the page, so it is untrusted. */
export interface RawCapture {
  /** Address of the document that was read, to check it is still the tab's page. */
  url: string;
  title: string;
  html: string | null;
  meta: MetaTag[];
}

/**
 * Runs inside the tab (isolated world) through `scripting.executeScript`. The browser serializes
 * it with `toString()`, so it must not use imports or anything outside its own body: the limits
 * are repeated here on purpose and tested against the exported constants.
 */
export function capturePage(): RawCapture {
  const maxHtml = 2 * 1024 * 1024;
  const maxMeta = 64;
  const maxKey = 100;
  const maxContent = 1000;
  const meta: { key: string; content: string }[] = [];
  for (const element of Array.from(document.querySelectorAll('meta'))) {
    if (meta.length >= maxMeta) break;
    const key = (element.getAttribute('property') ?? element.getAttribute('name'))?.trim();
    const content = element.getAttribute('content');
    if (!key || !content) continue;
    meta.push({ key: key.toLowerCase().slice(0, maxKey), content: content.slice(0, maxContent) });
  }
  const html = document.documentElement.outerHTML;
  return {
    url: location.href,
    title: document.title,
    html: html.length > maxHtml ? null : html,
    meta,
  };
}

function isMetaTag(value: unknown): value is MetaTag {
  if (typeof value !== 'object' || value === null) return false;
  const { key, content } = value as Record<string, unknown>;
  return typeof key === 'string' && typeof content === 'string' && key.length > 0;
}

function withoutHash(value: string): string | null {
  const url = toHttpUrl(value);
  return url && url.split('#')[0]!;
}

/**
 * Turns what the injected script returned into a page to save. The URL always comes from the
 * browser (the tab), never from the page. Anything malformed is dropped, never trusted, and so is
 * a capture of another address (the tab navigated while it was read).
 */
export function toCapturedPage(url: string, fallbackTitle: string, value: unknown): Page {
  const object =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const samePage = typeof object.url === 'string' && withoutHash(object.url) === withoutHash(url);
  const raw = samePage ? object : {};
  const title =
    (typeof raw.title === 'string' ? raw.title.trim() : '') || fallbackTitle.trim() || url;
  const page: Page = { url, title: title.slice(0, MAX_TITLE) };
  if (typeof raw.html === 'string' && raw.html.length <= MAX_HTML_LENGTH) page.html = raw.html;
  if (Array.isArray(raw.meta)) {
    page.meta = raw.meta
      .filter(isMetaTag)
      .slice(0, MAX_META_TAGS)
      .map(({ key, content }) => ({
        key: key.toLowerCase().slice(0, MAX_META_KEY),
        content: content.slice(0, MAX_META_CONTENT),
      }));
  }
  return page;
}

/** The parts of the browser API that reading the tab uses, so tests can pass a fake. */
export interface TabApi {
  tabs: {
    query(query: {
      active: true;
      currentWindow: true;
    }): Promise<{ id?: number; url?: string; title?: string }[]>;
  };
  scripting: {
    executeScript(injection: {
      target: { tabId: number };
      func: () => RawCapture;
    }): Promise<{ result?: unknown }[]>;
  };
}

/**
 * Reads the page open in the active tab. Needs `activeTab` (granted when the popup opens) and
 * `scripting`. Returns null when the tab is not a web page. When the page cannot be read (stores,
 * PDF viewer, reader view), it still returns the address and title so the save goes on.
 */
export async function readActiveTab(api: TabApi): Promise<Page | null> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  const url = toHttpUrl(tab?.url);
  if (!tab || !url) return null;
  const fallbackTitle = tab.title ?? '';
  if (tab.id === undefined) return toCapturedPage(url, fallbackTitle, null);
  try {
    const [first] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
    });
    return toCapturedPage(url, fallbackTitle, first?.result);
  } catch {
    return toCapturedPage(url, fallbackTitle, null);
  }
}
