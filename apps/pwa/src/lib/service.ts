import type { ImageData, PasswordStrength, Priority, SanitizedHtml, Tone } from '@stash/ui';

/**
 * Everything the screens need from Stash. Screens only talk to this interface:
 * the real service (`real/realService.ts`, over encryption, sync and the local
 * cache) implements it, and so does the in-memory mock for tests and design.
 */

export type Source = 'web' | 'x' | 'reddit' | 'instagram' | 'tiktok';
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
  /** When it was last marked read, discarded or pending again (milliseconds); null if never. */
  statusChangedAt: number | null;
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
  /** Instagram and TikTok always, and any source that blocked reading. */
  | { kind: 'preview'; description?: string; image?: ImageData; blocked: boolean }
  /** Queued: nothing downloaded yet. */
  | { kind: 'none' };

/** What saving a link ends in: `alreadySaved` when it was already in Stash and nothing was created. */
export type SavedItem = Item & { alreadySaved: boolean };

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
  | 'rate-limited'
  | 'offline';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
  }
}

/** Reverts a change; like any change, it needs the network. */
export type Undo = () => Promise<void>;

export type ChangeErrorCode = 'offline' | 'rate-limited' | 'failed';

/** A change to the saved data that could not be made. */
export class ChangeError extends Error {
  readonly code: ChangeErrorCode;

  constructor(code: ChangeErrorCode) {
    super(code);
    this.name = 'ChangeError';
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
  /**
   * Sets a new password with the recovery code and signs in. The old code stops
   * working: the new one is returned to show once.
   */
  recover(
    email: string,
    recoveryCode: string,
    newPassword: string,
  ): Promise<{ recoveryCode: string }>;
  /** Needs the current password; other devices are signed out. */
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  /** Signs out and clears the local copy on this device. */
  logout(): Promise<void>;
  deleteAccount(password: string): Promise<void>;

  // Items.
  listItems(): Promise<Item[]>;
  getItem(id: string): Promise<ItemDetail | null>;
  /**
   * Saves a link; offline it waits in the queue (queued: true). A link already saved creates
   * nothing: the existing item comes back with `alreadySaved: true`.
   */
  save(url: string): Promise<SavedItem>;
  classify(id: string, change: Classification): Promise<void>;
  /** Marks read, discarded or pending. Returns the undo, which restores the previous status. */
  setStatus(id: string, status: Status): Promise<Undo>;
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
