<script lang="ts">
  import { toastMotion } from './transitions';

  export interface UndoToastData {
    /** A new id replaces the current toast and restarts the 5 s. */
    id: string | number;
    /** For example "Marcado como leído". */
    message: string;
  }

  interface Props {
    toast: UndoToastData | null;
    onundo: (id: UndoToastData['id']) => void;
    /** The time ran out without Deshacer. */
    onexpire: (id: UndoToastData['id']) => void;
    duration?: number;
  }

  let { toast, onundo, onexpire, duration = 5000 }: Props = $props();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = 0;
  let startedAt = 0;
  let focused = false;

  function start() {
    clearTimeout(timer);
    if (!toast || focused || document.hidden) return;
    const id = toast.id;
    startedAt = Date.now();
    timer = setTimeout(() => onexpire(id), remaining);
  }

  function pause() {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
    remaining -= Date.now() - startedAt;
  }

  $effect(() => {
    void toast?.id;
    remaining = duration;
    focused = false;
    start();
    return () => {
      clearTimeout(timer);
      timer = undefined;
    };
  });

  // The time does not run while the page is hidden.
  function onvisibilitychange() {
    if (document.hidden) pause();
    else start();
  }
</script>

<svelte:document {onvisibilitychange} />

<div class="region" role="status">
  {#if toast}
    {#key toast.id}
      <div
        class="toast"
        transition:toastMotion
        onfocusin={() => {
          focused = true;
          pause();
        }}
        onfocusout={() => {
          focused = false;
          start();
        }}
      >
        <span class="msg">{toast.message}</span>
        <button type="button" class="undo" onclick={() => onundo(toast.id)}>Deshacer</button>
      </div>
    {/key}
  {/if}
</div>

<style>
  .region {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(var(--toast-offset, 86px) + env(safe-area-inset-bottom, 0px));
    z-index: 10;
    pointer-events: none;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 16px;
    border-radius: var(--radius-block);
    background: var(--ink);
    color: var(--bg);
    font-size: 15px;
    box-shadow: var(--shadow-lift);
    pointer-events: auto;
  }
  .msg {
    flex: 1;
  }
  .undo {
    min-height: 44px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: inherit;
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .undo:focus-visible {
    outline-color: var(--bg);
  }
</style>
