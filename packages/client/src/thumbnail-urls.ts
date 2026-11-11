import type { ItemView } from '@stash/core/sync';

export interface ThumbnailUrls {
  /** The `blob:` URL of the item's decrypted thumbnail, or undefined when it has none. */
  of(view: Pick<ItemView, 'id' | 'thumbnail'>): string | undefined;
  /** Revokes the URLs of every item not in `ids` (deleted items). */
  keepOnly(ids: ReadonlySet<string>): void;
  /** Revokes everything: the session ended. */
  clear(): void;
}

/**
 * Object URLs of the decrypted thumbnails, one per item, made once and revoked when the image
 * changes, the item disappears or the session ends. They live in memory only: the image is never
 * written anywhere in the clear, and only `blob:` URLs ever reach an `<img>`.
 */
export function createThumbnailUrls(): ThumbnailUrls {
  const urls = new Map<string, { bytes: Uint8Array; url: string }>();

  function drop(id: string): void {
    const current = urls.get(id);
    if (current) URL.revokeObjectURL(current.url);
    urls.delete(id);
  }

  return {
    of(view) {
      const current = urls.get(view.id);
      if (current && current.bytes === view.thumbnail?.bytes) return current.url;
      drop(view.id);
      if (!view.thumbnail) return undefined;
      const { bytes, type } = view.thumbnail;
      const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
      urls.set(view.id, { bytes, url });
      return url;
    },
    keepOnly(ids) {
      for (const id of [...urls.keys()]) if (!ids.has(id)) drop(id);
    },
    clear() {
      for (const id of [...urls.keys()]) drop(id);
    },
  };
}
