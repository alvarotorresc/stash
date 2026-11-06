import type { ImageData, PasswordStrength, Priority, SanitizedHtml, Tone } from '@stash/ui';

/**
 * Everything the screens need from Stash. Screens only talk to this interface;
 * the in-memory mock implements it today and the real client (encryption,
 * sync and local cache) will implement it later without touching the screens.
 */

export type Source = 'web' | 'x' | 'reddit' | 'instagram';
export type Status = 'pending' | 'read' | 'discarded';

export interface Category {
  id: string;
  name: string;
  /** Saved items in this category. */
  count: number;
}

export interface TagInfo {
  name: string;
  /** Saved items that use the tag. */
  count: number;
}

export interface Item {
  id: string;
  url: string;
  /** Provisional title (the URL) until the page can be read. */
  title: string;
  source: Source;
  /** Domain, subreddit or account, for example "r/askspain". */
  origin: string;
  priority: Priority | null;
  categoryId: string | null;
  tags: string[];
  status: Status;
  /** Milliseconds since the epoch. */
  savedAt: number;
  /** Saved offline, waiting to upload and to be read. */
  queued: boolean;
  thumbnail: { src?: string; tone: Tone };
}

export type ItemContent =
  | { kind: 'article'; meta: string; image?: ImageData; html: SanitizedHtml }
  | {
      kind: 'tweet';
      author: { name: string; handle: string };
      html: SanitizedHtml;
      images: ImageData[];
      date: string;
    }
  | { kind: 'reddit'; meta: string; html: SanitizedHtml }
  /** Instagram always, and any source that blocked reading. */
  | { kind: 'preview'; description?: string; image?: ImageData; blocked: boolean }
  /** Queued: nothing downloaded yet. */
  | { kind: 'none' };

export interface ItemDetail extends Item {
  content: ItemContent;
}

export interface Classification {
  priority?: Priority | null;
  categoryId?: string | null;
  tags?: string[];
}

export interface SearchFilters {
  query: string;
  status: Status | 'all';
  source: Source | 'all';
  /** A category id, "none" for items without one, or "all". */
  category: string;
  priority: Priority | 'all';
}

export interface SearchResult {
  item: Item;
  /** Text around the match when it is in the body and not in the title. */
  snippet?: string;
}

export interface Session {
  email: string;
  /** The device remembers the session until this date. */
  rememberedUntil: Date;
}

export type AccountErrorCode =
  | 'invalid-credentials'
  | 'email-taken'
  | 'weak-password'
  | 'invalid-code'
  | 'wrong-password'
  | 'offline';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface StashService {
  // Session and account.
  getSession(): Promise<Session | null>;
  /** Email of the last session on this device, to unlock without typing it. */
  lastEmail(): string | null;
  passwordStrength(password: string): PasswordStrength | null;
  /** Creates the account and signs in. Returns the recovery code, shown once. */
  register(email: string, password: string): Promise<{ recoveryCode: string }>;
  login(email: string, password: string): Promise<void>;
  /** Sets a new password with the recovery code and signs in. */
  recover(email: string, recoveryCode: string, newPassword: string): Promise<void>;
  /** Signs out and clears the local copy on this device. */
  logout(): Promise<void>;
  deleteAccount(password: string): Promise<void>;

  // Items.
  listItems(): Promise<Item[]>;
  getItem(id: string): Promise<ItemDetail | null>;
  /** Saves a link; offline it waits in the queue (queued: true). */
  save(url: string): Promise<Item>;
  classify(id: string, change: Classification): Promise<void>;
  /** Marks read or discarded; setting "pending" again is the undo. */
  setStatus(id: string, status: Status): Promise<void>;
  search(filters: SearchFilters): Promise<SearchResult[]>;

  // Categories, in order of importance.
  listCategories(): Promise<Category[]>;
  createCategory(name: string): Promise<Category>;
  renameCategory(id: string, name: string): Promise<void>;
  /** Its items lose the category; nothing is deleted. */
  deleteCategory(id: string): Promise<void>;
  reorderCategories(ids: string[]): Promise<void>;

  // Tags.
  listTags(): Promise<TagInfo[]>;
  renameTag(name: string, newName: string): Promise<void>;
  deleteTag(name: string): Promise<void>;

  /** Everything the account holds, as a file. */
  exportAll(): Promise<Blob>;

  // Connection.
  isOnline(): boolean;
  /** Called after any change (data, session or connection). Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}
