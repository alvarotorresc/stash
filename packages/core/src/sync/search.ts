/**
 * Filters and search over the decrypted items, on the device: the server cannot read anything,
 * so this is the only place search can happen.
 */
import type { Priority } from '../priority';
import type { Category, Item, ItemStatus, Source, Tag } from './model';

/** An item ready to show: its category and tags resolved, and whether it waits to upload. */
export interface ItemView extends Item {
  /** Title to show: the preview's, or the URL until the link has been read. */
  readonly title: string;
  /** The category, or null when unclassified (also when its category was deleted). */
  readonly category: Category | null;
  /** Tags that still exist, in the item's order. */
  readonly tags: readonly Tag[];
  /** Saved without connection, waiting to upload. */
  readonly queued: boolean;
}

export interface ItemFilters {
  /** Words to find in the title, URL, description, author or content. */
  readonly query?: string;
  readonly status?: ItemStatus | 'all';
  readonly source?: Source | 'all';
  /** A category id, null for unclassified items, or 'all'. */
  readonly categoryId?: string | null | 'all';
  /** A priority, null for items without one, or 'all'. */
  readonly priority?: Priority | null | 'all';
  /** A tag id, or 'all'. */
  readonly tagId?: string;
  /** Only items still to classify (see `isUnclassified`). */
  readonly unclassified?: boolean;
}

export interface SearchResult {
  readonly item: ItemView;
  /** Text around the match when it is in the content and not in the title. */
  readonly snippet?: string;
}

/** An item is still to classify while it lacks a priority or a category. */
export function isUnclassified(item: ItemView): boolean {
  return item.priority === null || item.category === null;
}

const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/** Review order: high, medium, low, then no priority; newest first within each. */
export function byPriority(a: Item, b: Item): number {
  const rank = (item: Item) => (item.priority === null ? 3 : PRIORITY_RANK[item.priority]);
  return rank(a) - rank(b) || b.savedAt - a.savedAt;
}

/** Lowercase, without accents, so "canción" matches "cancion". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

const SNIPPET_RADIUS = 60;

function snippetOf(text: string, folded: string, term: string): string | undefined {
  const at = folded.indexOf(term);
  if (at < 0) return undefined;
  // Folding removes combining marks only, so offsets stay close enough for a snippet.
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + term.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

function matchesFilters(item: ItemView, filters: ItemFilters): boolean {
  const { status = 'all', source = 'all', categoryId = 'all', priority = 'all' } = filters;
  const tagId = filters.tagId ?? 'all';
  return (
    (status === 'all' || item.status === status) &&
    (source === 'all' || item.source === source) &&
    (categoryId === 'all' || (item.category?.id ?? null) === categoryId) &&
    (priority === 'all' || item.priority === priority) &&
    (tagId === 'all' || item.tags.some((tag) => tag.id === tagId)) &&
    (filters.unclassified !== true || isUnclassified(item))
  );
}

/**
 * Items that pass every filter and contain every word of the query, newest first. A match in
 * the content but not in the title comes with a snippet.
 */
export function searchItems(items: readonly ItemView[], filters: ItemFilters = {}): SearchResult[] {
  const terms = foldText(filters.query ?? '')
    .split(/\s+/)
    .filter((term) => term.length > 0);
  const results: SearchResult[] = [];
  for (const item of items) {
    if (!matchesFilters(item, filters)) continue;
    if (terms.length === 0) {
      results.push({ item });
      continue;
    }
    const head = foldText(
      [
        item.title,
        item.url,
        item.preview?.description,
        item.preview?.author,
        item.preview?.siteName,
        ...item.tags.map((tag) => tag.name),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    const body = item.content?.text ?? '';
    const foldedBody = foldText(body);
    if (!terms.every((term) => head.includes(term) || foldedBody.includes(term))) continue;
    const inTitle = terms.some((term) => foldText(item.title).includes(term));
    const bodyTerm = terms.find((term) => !head.includes(term)) ?? terms[0];
    const snippet =
      inTitle || bodyTerm === undefined ? undefined : snippetOf(body, foldedBody, bodyTerm);
    results.push(snippet === undefined ? { item } : { item, snippet });
  }
  return results.sort((a, b) => b.item.savedAt - a.item.savedAt);
}
