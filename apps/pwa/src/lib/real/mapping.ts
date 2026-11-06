/**
 * From the synced model (`ItemView`) to what the screens show. Pure functions: the
 * real service passes in what they need, such as the thumbnail URL.
 */
import type { CategoryView, ItemFilters, ItemView, TagView } from '@stash/core/sync';
import { sanitizeStoredHtml } from '@stash/reader';
import type { SanitizedHtml, Tone } from '@stash/ui';
import type { Category, Item, ItemContent, ItemDetail, SearchFilters, TagInfo } from '../service';

const WORDS_PER_MINUTE = 200;

const host = (url: URL) => url.hostname.replace(/^www\./, '');

/** The link as an http(s) URL, or null: only those may become an `href`. */
function webUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * The link to open. Saving only accepts http(s), but records also arrive from other
 * devices of the account: anything else never reaches an `href`.
 */
export function safeHref(value: string): string {
  return webUrl(value)?.href ?? 'about:blank';
}

/** Domain, subreddit or account, for example "r/askspain" or "@ana". */
export function originOf(item: Pick<ItemView, 'url' | 'source'>): string {
  const url = webUrl(item.url);
  if (!url) return '';
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (item.source === 'reddit' && first === 'r' && second) return `r/${second}`;
  if (item.source === 'x' && first && first !== 'i') return `@${first}`;
  return host(url);
}

/** Placeholder tone for the thumbnail, stable for each item. */
export function toneOf(id: string): Tone {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % 4) + 1) as Tone;
}

export function toItem(view: ItemView, thumbnail?: string): Item {
  return {
    id: view.id,
    url: safeHref(view.url),
    title: view.title,
    source: view.source,
    origin: originOf(view),
    priority: view.priority,
    categoryId: view.categoryId,
    tags: view.tags.map((tag) => tag.name),
    status: view.status,
    savedAt: view.savedAt,
    queued: view.queued,
    thumbnail: thumbnail ? { src: thumbnail, tone: toneOf(view.id) } : { tone: toneOf(view.id) },
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
 * HTML to render, always through the stored-HTML sanitizer right before it reaches
 * the screen, whatever its origin (fresh read, cache or another device). Content kept
 * without HTML (too large) shows its text, escaped, one paragraph per line. With the
 * item's URL, links saved against the app's own origin point back to the page.
 */
export function renderableHtml(
  content: { html?: string; text: string },
  pageUrl?: string,
): SanitizedHtml {
  const html =
    content.html ??
    content.text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
  return sanitizeStoredHtml(html, pageUrl) as SanitizedHtml;
}

function readingMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

const dateFormat = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/** "14 oct 2026, 18:02", or only the day when the source gives no time. */
export function formatPublished(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return (value.includes('T') ? dateTimeFormat : dateFormat).format(date);
}

/** What the reading screen shows for an item, by what could be read of it. */
export function toContent(view: ItemView, image?: string): ItemContent {
  if (view.queued) return { kind: 'none' };
  const content = view.content;
  const picture = image ? { src: image, alt: '' } : undefined;
  const readable =
    content !== null && content.kind !== 'none' && !!(content.html || content.text.trim());
  if (!readable) {
    return {
      kind: 'preview',
      description: view.preview?.description ?? undefined,
      image: picture,
      // X and Reddit were read and gave nothing: they blocked it. Instagram is
      // always a preview; a web page without text keeps its preview and link.
      blocked: content !== null && (view.source === 'x' || view.source === 'reddit'),
    };
  }
  const html = renderableHtml(content, view.url);
  const origin = originOf(view);
  if (content.kind === 'tweet') {
    const name = view.preview?.author ?? origin;
    return {
      kind: 'tweet',
      author: { name, handle: origin },
      html,
      images: picture ? [picture] : [],
      date: formatPublished(view.preview?.publishedAt ?? null),
    };
  }
  if (content.kind === 'post') {
    const author = view.preview?.author;
    return { kind: 'reddit', meta: author ? `${origin} · ${author}` : origin, html };
  }
  return {
    kind: 'article',
    meta: `${origin} · ${readingMinutes(content.text)} min`,
    image: picture,
    html,
  };
}

export function toDetail(view: ItemView, thumbnail?: string): ItemDetail {
  return { ...toItem(view, thumbnail), content: toContent(view, thumbnail) };
}

export function toCategory(view: CategoryView): Category {
  return { id: view.id, name: view.name, count: view.count };
}

export function toTag(view: TagView): TagInfo {
  return { name: view.name, count: view.count };
}

/** The screen's filters in the sync client's terms ("none" is no category). */
export function toFilters(filters: SearchFilters): ItemFilters {
  return {
    query: filters.query,
    status: filters.status,
    source: filters.source,
    categoryId: filters.category === 'none' ? null : filters.category,
    priority: filters.priority,
  };
}
