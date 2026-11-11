import type { Item, Source } from './service';

export const SOURCE_LABELS: Record<Source, string> = {
  web: 'Web',
  x: 'X',
  reddit: 'Reddit',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

/** "Reddit, r/askspain": the origin line of a row. */
export const originLabel = (item: Item) => `${SOURCE_LABELS[item.source]}, ${item.origin}`;

/** "5 dic.": short date in Spanish. */
export const shortDate = (date: Date) =>
  new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(date);

/** "n guardado" or "n guardados". */
export const savedCount = (count: number) => `${count} ${count === 1 ? 'guardado' : 'guardados'}`;
