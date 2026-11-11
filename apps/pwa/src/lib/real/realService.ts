import { createThumbnailUrls, type Stash } from '@stash/client';
import { AccountApiError, CryptoError, checkPassword } from '@stash/core';
import { SyncError, type ItemView } from '@stash/core/sync';
import type { PasswordStrength } from '@stash/ui';
import {
  AccountError,
  ChangeError,
  type Category,
  type SearchResult,
  type StashService,
} from '../service';
import { toCategory, toDetail, toFilters, toItem, toTag } from './mapping';

/** Which screen asked: the same server answer means a different thing on each. */
type AccountAction = 'enter' | 'recover' | 'confirm';

/** An account failure as the screens name it; anything unexpected passes as is. */
function accountError(failure: unknown, action: AccountAction): unknown {
  if (failure instanceof CryptoError) {
    if (failure.code === 'PASSWORD_TOO_SHORT') return new AccountError('weak-password');
    if (failure.code === 'INVALID_RECOVERY_CODE') return new AccountError('invalid-code');
  }
  if (!(failure instanceof AccountApiError)) return failure;
  switch (failure.code) {
    case 'INVALID_CREDENTIALS':
      return new AccountError(
        action === 'recover'
          ? 'invalid-code'
          : action === 'confirm'
            ? 'wrong-password'
            : 'invalid-credentials',
      );
    case 'EMAIL_TAKEN':
      return new AccountError('email-taken');
    case 'RATE_LIMITED':
      return new AccountError('rate-limited');
    case 'NETWORK_ERROR':
      return new AccountError('offline');
    default:
      return failure;
  }
}

/** A failed change to the data, as the screens name it. */
function changeError(failure: unknown): ChangeError {
  if (failure instanceof SyncError && failure.code === 'OFFLINE') return new ChangeError('offline');
  if (failure instanceof SyncError && failure.code === 'RATE_LIMITED') {
    return new ChangeError('rate-limited');
  }
  return new ChangeError('failed');
}

async function asAccount<T>(action: AccountAction, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (failure) {
    throw accountError(failure, action);
  }
}

/** The recovery code without separators: the screen shows it in groups of four. */
const plainCode = (code: string) => code.replace(/[\s-]/g, '');

/** Standard base64 of some bytes, in chunks so a large array does not overflow the call stack. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

const fold = (value: string) => value.normalize('NFC').trim().toLocaleLowerCase();

/** Strength meter from the core's password check: length and very common passwords. */
export function passwordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  const { length, lengthOk, common } = checkPassword(password);
  if (common) return { level: 0, blocked: true, message: 'Muy común: elige otra' };
  if (!lengthOk) return { level: 1, blocked: false, message: 'Mínimo 10 caracteres' };
  if (length < 14) return { level: 2, blocked: false, message: 'Aceptable' };
  if (length < 18) return { level: 3, blocked: false, message: 'Buena' };
  return { level: 4, blocked: false, message: 'Muy buena' };
}

/**
 * The screens' service over the real client: accounts, the encrypted sync and its
 * local cache, the extraction proxy and the reader. Reads come from the decrypted
 * copy in memory; every change goes through `stash.change`, one at a time.
 */
export function createRealService(stash: Stash): StashService {
  const { sync } = stash;
  const thumbnails = createThumbnailUrls();
  let lastEmail: string | null = null;

  const item = (view: ItemView) => toItem(view, thumbnails.of(view));

  async function change<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await stash.change(run);
    } catch (failure) {
      throw changeError(failure);
    }
  }

  /** The decrypted copy is ready once the cache is open; a failure shows as a load error. */
  const ready = () => stash.start();

  return {
    async getSession() {
      const session = await stash.session();
      lastEmail = session?.email ?? (await stash.lastEmail());
      if (!session) {
        thumbnails.clear();
        return null;
      }
      // Opens the encrypted cache, then syncs in the background; once per session.
      // If the cache cannot open, the lists say so and offer to retry.
      await ready().catch(() => {});
      return { email: session.email, rememberedUntil: new Date(session.expiresAt) };
    },

    lastEmail: () => lastEmail,

    passwordStrength,

    async register(email, password) {
      const { recoveryCode } = await asAccount('enter', () => stash.register({ email, password }));
      return { recoveryCode: plainCode(recoveryCode) };
    },

    async login(email, password) {
      await asAccount('enter', () => stash.login({ email, password }));
    },

    async recover(email, recoveryCode, newPassword) {
      const result = await asAccount('recover', () =>
        stash.recover({ email, recoveryCode, newPassword }),
      );
      return { recoveryCode: plainCode(result.recoveryCode) };
    },

    async changePassword(currentPassword, newPassword) {
      await asAccount('confirm', () => stash.changePassword({ currentPassword, newPassword }));
    },

    async logout() {
      await stash.logout();
      thumbnails.clear();
    },

    async deleteAccount(password) {
      await asAccount('confirm', () => stash.deleteAccount({ password }));
      thumbnails.clear();
    },

    async listItems() {
      await ready();
      const views = sync.listItems();
      // Items deleted here or on another device leave no object URL behind.
      thumbnails.keepOnly(new Set(views.map((view) => view.id)));
      return views.map(item);
    },

    async getItem(id) {
      await ready();
      const view = sync.getItem(id);
      return view ? toDetail(view, thumbnails.of(view)) : null;
    },

    async save(url) {
      try {
        const saved = await stash.save(url);
        return { ...item(saved), alreadySaved: saved.alreadySaved };
      } catch (failure) {
        throw changeError(failure);
      }
    },

    async classify(id, { categoryId, priority, tags }) {
      await change(() => sync.classify(id, { categoryId, priority, tags }));
    },

    async setStatus(id, status) {
      const undo = await change(() => sync.setStatus(id, status));
      return () => change(undo);
    },

    async search(filters) {
      await ready();
      return sync
        .search(toFilters(filters))
        .map(({ item: view, snippet }): SearchResult =>
          snippet === undefined ? { item: item(view) } : { item: item(view), snippet },
        );
    },

    async listCategories() {
      await ready();
      return sync.listCategories().map(toCategory);
    },

    async createCategory(name): Promise<Category> {
      const existing = sync.listCategories().find((entry) => fold(entry.name) === fold(name));
      if (existing) return toCategory(existing);
      const created = await change(() => sync.createCategory(name));
      return { id: created.id, name: created.name, count: 0 };
    },

    async renameCategory(id, name) {
      await change(() => sync.renameCategory(id, name));
    },

    async deleteCategory(id) {
      await change(() => sync.deleteCategory(id));
    },

    async reorderCategories(ids) {
      await change(() => sync.reorderCategories(ids));
    },

    async listTags() {
      await ready();
      return sync.listTags().map(toTag);
    },

    async renameTag(name, newName) {
      const tag = sync.listTags().find((entry) => entry.name === name);
      if (tag) await change(() => sync.renameTag(tag.id, newName));
    },

    async deleteTag(name) {
      const tag = sync.listTags().find((entry) => entry.name === name);
      if (tag) await change(() => sync.deleteTag(tag.id));
    },

    async exportAll() {
      await ready();
      const data = {
        exportedAt: new Date().toISOString(),
        items: sync.listItems().map((view) => ({
          url: view.url,
          title: view.title,
          source: view.source,
          status: view.status,
          priority: view.priority,
          category: view.category?.name ?? null,
          tags: view.tags.map((tag) => tag.name),
          savedAt: new Date(view.savedAt).toISOString(),
          preview: view.preview,
          thumbnail: view.thumbnail
            ? { type: view.thumbnail.type, base64: toBase64(view.thumbnail.bytes) }
            : null,
          text: view.content?.text ?? null,
        })),
        categories: sync.listCategories().map((entry) => entry.name),
        tags: sync.listTags().map((entry) => entry.name),
      };
      return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    },

    isOnline: () => stash.isOnline(),

    subscribe: (listener) => stash.subscribe(listener),
  };
}
