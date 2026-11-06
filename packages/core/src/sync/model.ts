/**
 * Domain model of what Stash keeps: items (saved links), categories and tags. Each one is a
 * record encrypted on the device; the server only sees its id, kind and version.
 *
 * Items point to their category and tags by id, so renaming one is a single record change. A
 * reference to a category or tag that no longer exists reads as unclassified or is ignored.
 */
import { isPriority, type Priority } from '../priority';
import { SyncError } from './errors';

export const ITEM_STATUSES = ['pending', 'read', 'discarded'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const SOURCES = ['web', 'x', 'reddit', 'instagram'] as const;
export type Source = (typeof SOURCES)[number];

/** What kind of readable content was extracted; `none` means preview only. */
export const CONTENT_KINDS = ['article', 'post', 'tweet', 'none'] as const;
export type ContentKind = (typeof CONTENT_KINDS)[number];

export const THUMBNAIL_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type ThumbnailType = (typeof THUMBNAIL_TYPES)[number];

/** Preview of a link, from its meta tags. Every field may be missing. */
export interface ItemPreview {
  readonly title: string | null;
  readonly description: string | null;
  readonly siteName: string | null;
  readonly author: string | null;
  /** Remote image URL, only to download it through the proxy; never load it directly. */
  readonly imageUrl: string | null;
  readonly publishedAt: string | null;
}

/** Content read on the device. `html` is already sanitised; `text` is for search. */
export interface ItemContent {
  readonly kind: ContentKind;
  readonly html?: string;
  readonly text: string;
}

/** Compressed thumbnail, kept encrypted with the item. */
export interface Thumbnail {
  readonly type: ThumbnailType;
  readonly bytes: Uint8Array;
}

export interface Item {
  readonly id: string;
  readonly url: string;
  readonly source: Source;
  /** Null until the link has been read (for example while it waits in the offline queue). */
  readonly preview: ItemPreview | null;
  readonly content: ItemContent | null;
  readonly thumbnail: Thumbnail | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  /** No priority is a valid choice: saving never forces classifying. */
  readonly priority: Priority | null;
  readonly status: ItemStatus;
  /** Milliseconds since the epoch. */
  readonly savedAt: number;
  readonly updatedAt: number;
  /** When it was last marked read, discarded or pending again; null if never. */
  readonly statusChangedAt: number | null;
}

export interface Category {
  readonly id: string;
  readonly name: string;
  /** Position by importance: lower comes first. */
  readonly order: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface Tag {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
}

export type RecordValue =
  | { readonly kind: 'item'; readonly value: Item }
  | { readonly kind: 'category'; readonly value: Category }
  | { readonly kind: 'tag'; readonly value: Tag };

export const MAX_URL_LENGTH = 2048;
export const MAX_CATEGORY_NAME_LENGTH = 60;
export const MAX_TAG_NAME_LENGTH = 40;

/** Trims, normalises to NFC and collapses runs of whitespace. */
function cleanName(value: string): string {
  return value.normalize('NFC').trim().replace(/\s+/g, ' ');
}

function validName(value: string, max: number, what: string): string {
  const name = cleanName(value);
  if (name.length === 0) throw new SyncError('INVALID_INPUT', `The ${what} needs a name`);
  if ([...name].length > max) {
    throw new SyncError('INVALID_INPUT', `The ${what} name is longer than ${max} characters`);
  }
  return name;
}

export function categoryName(value: string): string {
  return validName(value, MAX_CATEGORY_NAME_LENGTH, 'category');
}

export function tagName(value: string): string {
  return validName(value, MAX_TAG_NAME_LENGTH, 'tag');
}

/** Two tag names are the same tag when they match ignoring case. */
export function tagKey(name: string): string {
  return cleanName(name).toLocaleLowerCase();
}

/** The value as an absolute http(s) URL, or an `INVALID_INPUT` error. */
export function httpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new SyncError('INVALID_INPUT', 'Only web links can be saved');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SyncError('INVALID_INPUT', 'Only web links can be saved');
  }
  if (url.href.length > MAX_URL_LENGTH)
    throw new SyncError('INVALID_INPUT', 'The link is too long');
  return url.href;
}

/** Where a link comes from, by its host. Anything unknown is `web`. */
export function detectSource(url: string): Source {
  const host = new URL(url).hostname.toLowerCase().replace(/^(www|mobile|m|old)\./, '');
  if (host === 'x.com' || host === 'twitter.com') return 'x';
  if (host === 'reddit.com' || host === 'redd.it') return 'reddit';
  if (host === 'instagram.com') return 'instagram';
  return 'web';
}

/** Title to show: the preview's, or the URL until the link has been read. */
export function itemTitle(item: Pick<Item, 'preview' | 'url'>): string {
  return item.preview?.title?.trim() || item.url;
}

// Parsing of decrypted records. They were encrypted by a device of the same account, so they
// are authentic, but they may come from another version of the app: anything unexpected is
// rejected as a whole instead of half-read.

type Json = Record<string, unknown>;

function invalidRecord(): Error {
  return new Error('Record does not match the model');
}

function str(value: unknown): string {
  if (typeof value !== 'string') throw invalidRecord();
  return value;
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

function num(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidRecord();
  return value;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    throw invalidRecord();
  }
  return value as T;
}

function obj(value: unknown): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalidRecord();
  return value as Json;
}

function parsePreview(value: unknown): ItemPreview | null {
  if (value === null || value === undefined) return null;
  const p = obj(value);
  return {
    title: strOrNull(p.title),
    description: strOrNull(p.description),
    siteName: strOrNull(p.siteName),
    author: strOrNull(p.author),
    imageUrl: strOrNull(p.imageUrl),
    publishedAt: strOrNull(p.publishedAt),
  };
}

function parseContent(value: unknown): ItemContent | null {
  if (value === null || value === undefined) return null;
  const c = obj(value);
  const kind = oneOf(CONTENT_KINDS, c.kind);
  const text = str(c.text);
  return c.html === undefined ? { kind, text } : { kind, html: str(c.html), text };
}

/** Item fields as stored inside the blob: everything but the id and the thumbnail bytes. */
export function parseItem(id: string, json: Json, thumbnail: Thumbnail | null): Item {
  const priority = json.priority ?? null;
  if (priority !== null && !isPriority(priority)) throw invalidRecord();
  if (!Array.isArray(json.tagIds)) throw invalidRecord();
  return {
    id,
    url: str(json.url),
    source: oneOf(SOURCES, json.source),
    preview: parsePreview(json.preview),
    content: parseContent(json.content),
    thumbnail,
    categoryId: strOrNull(json.categoryId),
    tagIds: json.tagIds.map(str),
    priority,
    status: oneOf(ITEM_STATUSES, json.status),
    savedAt: num(json.savedAt),
    updatedAt: num(json.updatedAt),
    statusChangedAt: json.statusChangedAt == null ? null : num(json.statusChangedAt),
  };
}

export function parseCategory(id: string, json: Json): Category {
  return {
    id,
    name: str(json.name),
    order: num(json.order),
    createdAt: num(json.createdAt),
    updatedAt: num(json.updatedAt),
  };
}

export function parseTag(id: string, json: Json): Tag {
  return { id, name: str(json.name), createdAt: num(json.createdAt) };
}

export function parseThumbnailType(value: unknown): ThumbnailType {
  return oneOf(THUMBNAIL_TYPES, value);
}
