/**
 * Hash routes: they work from the static host and from the service worker's
 * precached index without server rules.
 */

export type Route =
  | { name: 'pending' }
  | { name: 'search' }
  | { name: 'categories' }
  | { name: 'item'; id: string }
  | { name: 'settings' }
  | { name: 'tags' }
  | { name: 'login' }
  | { name: 'register' }
  | { name: 'recover' };

const STATIC: Record<string, Route> = {
  '': { name: 'pending' },
  '/': { name: 'pending' },
  '/buscar': { name: 'search' },
  '/categorias': { name: 'categories' },
  '/ajustes': { name: 'settings' },
  '/ajustes/etiquetas': { name: 'tags' },
  '/entrar': { name: 'login' },
  '/crear-cuenta': { name: 'register' },
  '/recuperar': { name: 'recover' },
};

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  const item = /^\/leer\/([^/]+)$/.exec(path);
  if (item?.[1]) return { name: 'item', id: decodeURIComponent(item[1]) };
  return STATIC[path] ?? { name: 'pending' };
}

export function pathOf(route: Route): string {
  if (route.name === 'item') return `/leer/${encodeURIComponent(route.id)}`;
  const entry = Object.entries(STATIC).find(([path, value]) => path && value.name === route.name);
  return entry?.[0] ?? '/';
}

interface HistoryState {
  /** Steps taken inside the app; Back leaves the app only at 0. */
  depth: number;
}

const depthOf = (state: unknown) => (state as HistoryState | null)?.depth ?? 0;

export class Router {
  route = $state<Route>(parseHash(location.hash));
  /** Closes the open sheet when the system Back is pressed. */
  #overlay: (() => void) | null = null;

  constructor() {
    // pushState fires neither event, so these only see Back, Forward and typed URLs.
    window.addEventListener('popstate', () => {
      this.route = parseHash(location.hash);
      const close = this.#overlay;
      this.#overlay = null;
      close?.();
    });
    window.addEventListener('hashchange', () => {
      this.route = parseHash(location.hash);
    });
  }

  go(route: Route) {
    const path = pathOf(route);
    if (location.hash.replace(/^#/, '') === path) return;
    this.#push(path);
    this.route = route;
  }

  /** Replaces the current screen (after signing in or out), without a Back step. */
  replace(route: Route) {
    history.replaceState(history.state, '', `#${pathOf(route)}`);
    this.route = route;
  }

  /** Back inside the app, or to the given screen when the app was opened there. */
  back(fallback: Route = { name: 'pending' }) {
    if (depthOf(history.state) > 0) history.back();
    else this.replace(fallback);
  }

  /** A sheet opened: the system Back closes it instead of leaving the screen. */
  openOverlay(onback: () => void) {
    if (this.#overlay) return;
    this.#overlay = onback;
    this.#push(location.hash.replace(/^#/, '') || '/');
  }

  /** The sheet closed from the interface: drop its history step. */
  closeOverlay() {
    if (!this.#overlay) return;
    this.#overlay = null;
    history.back();
  }

  #push(path: string) {
    const state: HistoryState = { depth: depthOf(history.state) + 1 };
    history.pushState(state, '', `#${path}`);
  }
}
