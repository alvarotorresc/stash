<script lang="ts">
  import type { Snippet } from 'svelte';
  import { capturePointer } from './gestures';

  /** A quick flick closes the sheet regardless of distance (px per ms). */
  const FLICK_VELOCITY = 0.11;
  /** Exit duration (DESIGN.md: leaving is faster than entering). */
  const EXIT_MS = 200;

  interface Props {
    open: boolean;
    /** Swipe down, Escape or a tap on the scrim. What was done is kept. */
    onclose: () => void;
    /** Accessible name of the dialog. */
    label: string;
    /** Draggable top area under the handle (touch-action: none). */
    header?: Snippet;
    children: Snippet;
  }

  let { open, onclose, label, header, children }: Props = $props();

  let rendered = $state(false);
  let shown = $state(false);
  let dragging = $state(false);
  let sheet = $state<HTMLElement>();
  let returnFocus: HTMLElement | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let drag: { id: number; startY: number; startTime: number; offset: number } | null = null;

  $effect(() => {
    if (open) {
      clearTimeout(exitTimer);
      if (!rendered) returnFocus = document.activeElement as HTMLElement | null;
      rendered = true;
    } else if (rendered) {
      shown = false;
      exitTimer = setTimeout(() => {
        rendered = false;
        returnFocus?.focus();
      }, EXIT_MS);
    }
  });

  $effect(() => {
    if (!open || !sheet) return;
    // Flush the closed position so the entry transition runs.
    void sheet.offsetHeight;
    shown = true;
    sheet.focus();
  });

  $effect(() => () => clearTimeout(exitTimer));

  function focusables(): HTMLElement[] {
    return sheet
      ? [
          ...sheet.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
          ),
        ]
      : [];
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    const current = document.activeElement;
    if (event.shiftKey && (current === first || current === sheet)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onpointerdown(event: PointerEvent) {
    if (drag || !event.isPrimary) return;
    drag = { id: event.pointerId, startY: event.clientY, startTime: event.timeStamp, offset: 0 };
    dragging = true;
    capturePointer(event.currentTarget as Element, event.pointerId);
  }

  function onpointermove(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id || !sheet) return;
    const dy = event.clientY - drag.startY;
    // Past the top: resistance instead of a hard stop.
    drag.offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 2;
    sheet.style.transform = `translateY(${drag.offset}px)`;
  }

  function onpointerup(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id || !sheet) return;
    const elapsed = Math.max(1, event.timeStamp - drag.startTime);
    const velocity = drag.offset / elapsed;
    const closes = drag.offset > sheet.offsetHeight / 3 || velocity > FLICK_VELOCITY;
    drag = null;
    dragging = false;
    sheet.style.transform = '';
    if (closes) onclose();
  }
</script>

{#if rendered}
  <div class="layer" class:shown>
    <button type="button" class="scrim" tabindex="-1" aria-label="Cerrar" onclick={onclose}
    ></button>
    <div
      bind:this={sheet}
      class="sheet"
      class:dragging
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabindex="-1"
      {onkeydown}
    >
      <div
        class="drag"
        role="presentation"
        {onpointerdown}
        {onpointermove}
        {onpointerup}
        onpointercancel={onpointerup}
      >
        <div class="grab"></div>
        {@render header?.()}
      </div>
      <div class="body">
        {@render children()}
      </div>
    </div>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: 20;
  }
  .scrim {
    position: absolute;
    inset: 0;
    padding: 0;
    border: 0;
    background: var(--scrim);
    opacity: 0;
    cursor: default;
    transition: opacity var(--dur-sheet-out) var(--ease-drawer);
  }
  .sheet {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: calc(100dvh - 24px);
    display: flex;
    flex-direction: column;
    border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
    background: var(--surface);
    color: var(--ink);
    box-shadow: var(--shadow-sheet);
    transform: translateY(100%);
    transition: transform var(--dur-sheet-out) var(--ease-drawer);
  }
  .sheet:focus-visible {
    outline: none;
  }
  .shown .scrim {
    opacity: 1;
    transition-duration: var(--dur-sheet-in);
  }
  .shown .sheet {
    transform: translateY(0);
    transition-duration: var(--dur-sheet-in);
  }
  .sheet.dragging {
    transition: none;
  }
  .drag {
    padding: 8px 18px 0;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    cursor: grab;
  }
  .grab {
    width: 36px;
    height: 4px;
    margin: 0 auto 14px;
    border-radius: 2px;
    background: var(--line-strong);
  }
  .body {
    padding: 0 18px calc(20px + env(safe-area-inset-bottom, 0px));
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  @media (prefers-reduced-motion: reduce) {
    .sheet {
      transform: none;
      opacity: 0;
      transition: opacity var(--dur-sheet-out) linear;
    }
    .shown .sheet {
      transform: none;
      opacity: 1;
    }
  }
</style>
