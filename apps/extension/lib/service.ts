import type { Priority, SanitizedHtml, TagSuggestion, Tone } from '@stash/ui';

/**
 * What the popup needs from Stash. Smaller than the PWA's service: the popup signs in, saves
 * the open page, classifies it and lists and reads what is saved. `popupService.ts` implements
 * it over the real client; `mock.ts` is an in-memory example for the component tests.
 */

export interface MetaTag {
  /** The `name` or `property` attribute, lower case. */
  key: string;
  content: string;
}

export interface Page {
  url: string;
  title: string;
  /**
   * HTML of the open tab, for reader mode on the device. Absent when the page could not be read
   * (browser pages, stores, PDF viewer) or was too large; the service then extracts it from the URL.
   */
  html?: string;
  /** Meta tags of the open tab, kept even when the HTML was too large to send. */
  meta?: MetaTag[];
}

export interface SavedItem {
  id: string;
  url: string;
  title: string;
  /** Domain shown under the title. */
  domain: string;
  priority: Priority | null;
  categoryId: string | null;
  tags: string[];
  thumbnail: { src?: string; tone: Tone };
}

export interface Classification {
  priority?: Priority | null;
  categoryId?: string | null;
  tags?: string[];
}

/** An item just saved: `alreadySaved` when that link was already in Stash and nothing was created. */
export interface SaveResult extends SavedItem {
  alreadySaved: boolean;
}

/** A saved link as the list shows it. */
export interface ListedItem {
  id: string;
  title: string;
  /** Domain, subreddit or account shown under the title. */
  origin: string;
  /** Saved without connection and waiting to upload. */
  queued: boolean;
  thumbnail: { src?: string; tone: Tone };
}

/** What the reading view shows, by what could be read of the page. */
export type ReadingContent =
  | { kind: 'article'; meta: string; html: SanitizedHtml }
  | { kind: 'preview'; description?: string }
  | { kind: 'none' };

export interface ItemDetail extends ListedItem {
  /** An http(s) address: the only kind that may become an `href`. */
  url: string;
  content: ReadingContent;
}

export type AccountErrorCode = 'invalid-credentials' | 'rate-limited' | 'offline' | 'no-access';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface PopupService {
  /** The session when the data key is unlocked too; null means "ask for the password". */
  getSession(): Promise<{ email: string } | null>;
  lastEmail(): string | null;
  login(email: string, password: string): Promise<void>;
  /** Closes the session and forgets the data key, the cache, the queue and waiting links. */
  logout(): Promise<void>;
  /** The page open in the active tab, or null when there is none. */
  currentTab(): Promise<Page | null>;
  save(page: Page): Promise<SaveResult>;
  /**
   * Saves the links picked from the context menu while there was no session, and returns how
   * many it saved. A link that fails stays for the next time.
   */
  savePendingLinks(): Promise<number>;
  classify(id: string, change: Classification): Promise<void>;
  listCategories(): Promise<{ id: string; name: string }[]>;
  /** Tags already used, most used first. */
  listTags(): Promise<TagSuggestion[]>;
  /** Links still to read, newest first. */
  listItems(): Promise<ListedItem[]>;
  getItem(id: string): Promise<ItemDetail | null>;
}

/** The value as an http(s) URL, or null: only web pages are saved. */
export function toHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
