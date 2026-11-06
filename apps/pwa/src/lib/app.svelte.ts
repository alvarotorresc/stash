import { getContext, setContext } from 'svelte';
import type { TagSuggestion, UndoToastData } from '@stash/ui';
import { changeMessage } from './attempt';
import { Router } from './router.svelte';
import type { Category, Item, Session, StashService, Status, TagInfo, Undo } from './service';

/** The save sheet: just shared, waiting offline, or classifying an existing item. */
export interface SheetState {
  variant: 'saved' | 'queued' | 'classify';
  itemId: string;
  /** The shared link was already saved. */
  duplicate?: boolean;
}

interface UndoAction {
  id: UndoToastData['id'];
  undo: Undo;
}

const MAX_TAG_SUGGESTIONS = 4;

/**
 * Reactive state shared by the screens. It reads through the service, keeps
 * the last copy for the screens to render, and reloads whenever the service
 * says something changed.
 */
export class AppState {
  readonly service: StashService;
  readonly router: Router;

  session = $state<Session | null>(null);
  /** The session check finished: until then nothing is shown. */
  ready = $state(false);
  items = $state<Item[]>([]);
  categories = $state<Category[]>([]);
  tags = $state<TagInfo[]>([]);
  online = $state(true);
  /** First load of the data: true until the first answer arrives. */
  loading = $state(true);
  loadFailed = $state(false);

  sheet = $state<SheetState | null>(null);
  toast = $state<UndoToastData | null>(null);
  /** Shown once after creating an account, before anything else. */
  recoveryCode = $state<string | null>(null);
  /** A link shared while signed out, saved after signing in. */
  pendingShare = $state<string | null>(null);
  /** Why the last change could not be made, until dismissed or the next one works. */
  failure = $state<string | null>(null);

  /** What Deshacer reverts: only the last action, like the toast. */
  #undo: UndoAction | null = null;
  #toastId = 0;

  constructor(service: StashService, router = new Router()) {
    this.service = service;
    this.router = router;
    this.online = service.isOnline();
    service.subscribe(() => {
      this.online = service.isOnline();
      void this.refresh();
    });
  }

  /** Session first; then the data, if there is a session. */
  async start() {
    this.session = await this.service.getSession();
    this.ready = true;
    await this.refresh();
  }

  async refresh() {
    this.session = await this.service.getSession();
    if (!this.session) {
      this.items = [];
      this.categories = [];
      this.tags = [];
      this.loading = true;
      return;
    }
    try {
      const [items, categories, tags] = await Promise.all([
        this.service.listItems(),
        this.service.listCategories(),
        this.service.listTags(),
      ]);
      this.items = items;
      this.categories = categories;
      this.tags = tags;
      this.loadFailed = false;
    } catch {
      this.loadFailed = true;
    } finally {
      this.loading = false;
    }
    if (this.pendingShare) {
      const url = this.pendingShare;
      this.pendingShare = null;
      await this.saveShared(url);
    }
  }

  item(id: string) {
    return this.items.find((item) => item.id === id);
  }

  categoryName(id: string | null) {
    return id ? this.categories.find((category) => category.id === id)?.name : undefined;
  }

  /** Tags already used that start with or contain the text, most used first. */
  tagSuggestions(query: string, exclude: string[] = []): TagSuggestion[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.tags
      .filter((tag) => tag.name.toLowerCase().includes(needle) && !exclude.includes(tag.name))
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_TAG_SUGGESTIONS);
  }

  /** Sharing already saves: the sheet only offers to classify. */
  async saveShared(url: string) {
    if (!this.session) {
      this.pendingShare = url;
      return;
    }
    try {
      const item = await this.service.save(url);
      this.openSheet({
        variant: item.queued ? 'queued' : 'saved',
        itemId: item.id,
        duplicate: item.alreadySaved,
      });
    } catch {
      this.failure = 'No se ha podido guardar el enlace. Vuelve a compartirlo en un momento.';
    }
  }

  /** Runs a change; on failure it tells why and returns false. */
  async change(run: () => Promise<unknown>): Promise<boolean> {
    try {
      await run();
      this.failure = null;
      return true;
    } catch (failure) {
      this.failure = changeMessage(failure);
      return false;
    }
  }

  dismissFailure() {
    this.failure = null;
  }

  openSheet(sheet: SheetState) {
    this.sheet = sheet;
    this.router.openOverlay(() => {
      this.sheet = null;
    });
  }

  closeSheet() {
    this.sheet = null;
    this.router.closeOverlay();
  }

  /** Marks it read; returns false when it could not (the failure says why). */
  markRead(id: string): Promise<boolean> {
    return this.#setStatus(id, 'read', 'Marcado como leído');
  }

  discard(id: string): Promise<boolean> {
    return this.#setStatus(id, 'discarded', 'Descartado');
  }

  async #setStatus(id: string, status: Status, message: string): Promise<boolean> {
    let undo: Undo | undefined;
    const done = await this.change(async () => {
      undo = await this.service.setStatus(id, status);
    });
    if (undo) this.#showUndo(message, undo);
    return done;
  }

  async undo(id: UndoToastData['id']) {
    const action = this.#undo?.id === id ? this.#undo : null;
    this.expire(id);
    if (action) await this.change(action.undo);
  }

  expire(id: UndoToastData['id']) {
    if (this.#undo?.id === id) this.#undo = null;
    if (this.toast?.id === id) this.toast = null;
  }

  /** One toast at a time: a new one replaces the previous. */
  #showUndo(message: string, undo: Undo) {
    const id = ++this.#toastId;
    this.#undo = { id, undo };
    this.toast = { id, message };
  }

  async logout() {
    await this.service.logout();
    this.toast = null;
    this.failure = null;
    this.router.replace({ name: 'login' });
  }
}

const KEY = Symbol('stash-app');

export function provideApp(app: AppState) {
  setContext(KEY, app);
}

export function useApp(): AppState {
  const app = getContext<AppState | undefined>(KEY);
  if (!app) throw new Error('AppState is not provided');
  return app;
}
