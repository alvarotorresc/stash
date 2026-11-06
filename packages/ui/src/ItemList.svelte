<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** ItemRow elements. */
    children: Snippet;
    /** Accessible name, for example the group it belongs to. */
    label?: string;
    /** No surface block: rows sit on the parent background (the unsorted strip). */
    bare?: boolean;
  }

  let { children, label, bare = false }: Props = $props();
</script>

<ul class="list" class:bare aria-label={label}>
  {@render children()}
</ul>

<style>
  .list {
    margin: 0 12px;
    padding: 0 14px;
    list-style: none;
    border-radius: var(--radius-block);
    background: var(--surface);
    overscroll-behavior: contain;
  }
  .bare {
    margin: 0;
    padding: 0;
    background: transparent;
  }
</style>
