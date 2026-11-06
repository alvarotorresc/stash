<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    /** Escape or a cancel button. */
    onclose: () => void;
    children: Snippet;
  }

  let { open, title, onclose, children }: Props = $props();
  const uid = $props.id();
  let dialog = $state<HTMLDialogElement>();

  // The native dialog traps focus, makes the page inert and returns focus on close.
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });

  function oncancel(event: Event) {
    event.preventDefault();
    onclose();
  }
</script>

<dialog bind:this={dialog} aria-labelledby="dialog-{uid}" {oncancel}>
  {#if open}
    <h2 id="dialog-{uid}">{title}</h2>
    {@render children()}
  {/if}
</dialog>

<style>
  dialog {
    width: min(100% - 32px, 420px);
    max-height: calc(100dvh - 32px);
    padding: 20px;
    border: 0;
    border-radius: var(--radius-block);
    background: var(--surface);
    color: var(--ink);
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  dialog::backdrop {
    background: color-mix(in srgb, var(--scrim) 70%, transparent);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 20px;
    font-weight: 700;
  }
</style>
