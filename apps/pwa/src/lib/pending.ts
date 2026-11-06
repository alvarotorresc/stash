import { PRIORITY_LABELS, type Priority } from '@stash/ui';
import type { Category, Item } from './service';

/** High, medium, low: the display order of the labels. */
const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];

export interface PendingView {
  /** Missing a priority or a category: shown first, in the amber strip. */
  unsorted: Item[];
  /** High, medium and low; empty groups are left out. */
  groups: { priority: Priority; items: Item[] }[];
  total: number;
}

/** An item is classified once it has both a priority and a category. */
export const isUnsorted = (item: Item) => item.priority === null || item.categoryId === null;

/**
 * Pending items by priority. Inside a group, categories higher in the list
 * come first, and then the newest.
 */
export function groupPending(items: Item[], categories: Category[]): PendingView {
  const rank = new Map(categories.map((category, index) => [category.id, index]));
  const pending = items.filter((item) => item.status === 'pending');
  const newest = (a: Item, b: Item) => b.savedAt - a.savedAt;
  const byImportance = (a: Item, b: Item) =>
    (rank.get(a.categoryId ?? '') ?? Infinity) - (rank.get(b.categoryId ?? '') ?? Infinity) ||
    newest(a, b);

  const unsorted = pending.filter(isUnsorted).sort(newest);
  const groups = PRIORITIES.map((priority) => ({
    priority,
    items: pending
      .filter((item) => !isUnsorted(item) && item.priority === priority)
      .sort(byImportance),
  })).filter((group) => group.items.length > 0);

  return { unsorted, groups, total: pending.length };
}
