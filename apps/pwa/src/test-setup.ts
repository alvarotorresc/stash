import { FastKdfWorker } from '@stash/client/testing';
import { vi } from 'vitest';

// jsdom gaps used by the components.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Svelte transitions run through the Web Animations API, which jsdom lacks.
// The stub finishes every animation right away.
if (!Element.prototype.animate) {
  Element.prototype.animate = function () {
    const animation = {
      currentTime: 0,
      playState: 'finished',
      finished: Promise.resolve(),
      cancel: () => {},
      play: () => {},
      pause: () => {},
      finish: () => {},
      set onfinish(callback: (() => void) | null) {
        if (callback) queueMicrotask(callback);
      },
      get onfinish() {
        return null;
      },
      oncancel: null,
    };
    return animation as unknown as Animation;
  };
}

// jsdom has <dialog> but not its modal methods.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}

// Argon2id runs in a module Web Worker, which jsdom lacks: derivations go through a
// fast stand-in; the rest of the key chain is the real one.
vi.stubGlobal('Worker', FastKdfWorker);

// jsdom has no object URLs; thumbnails only need a distinct blob: URL per image.
if (!URL.createObjectURL) {
  let next = 0;
  URL.createObjectURL = () => `blob:stash/${++next}`;
  URL.revokeObjectURL = () => {};
}
