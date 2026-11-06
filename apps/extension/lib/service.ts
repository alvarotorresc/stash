import type { PasswordStrength, Priority, TagSuggestion, Tone } from '@stash/ui';

/**
 * What the popup and the background need from Stash. Smaller than the PWA's
 * service: the popup only signs in, saves the open page and classifies it.
 * The in-memory mock implements it today; the real client comes later.
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

export type AccountErrorCode = 'invalid-credentials' | 'email-taken' | 'weak-password' | 'offline';

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode) {
    super(code);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface PopupService {
  getSession(): Promise<{ email: string } | null>;
  lastEmail(): string | null;
  passwordStrength(password: string): PasswordStrength | null;
  login(email: string, password: string): Promise<void>;
  /** Creates the account and signs in. Returns the recovery code, shown once. */
  register(email: string, password: string): Promise<{ recoveryCode: string }>;
  /** The page open in the active tab, or null when there is none. */
  currentTab(): Promise<Page | null>;
  save(page: Page): Promise<SavedItem>;
  classify(id: string, change: Classification): Promise<void>;
  listCategories(): Promise<{ id: string; name: string }[]>;
  /** Tags already used, most used first. */
  listTags(): Promise<TagSuggestion[]>;
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
