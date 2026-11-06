<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    count: number;
    /** Without connection the Clasificar button disappears (classifying needs the network). */
    online?: boolean;
    /** Opens the save sheet with the first unsorted item. */
    onclassify: () => void;
    /** ItemRow elements. */
    children: Snippet;
  }

  let { count, online = true, onclassify, children }: Props = $props();
  const uid = $props.id();
</script>

{#if count > 0}
  <section class="flag" aria-labelledby="unsorted-{uid}">
    <div class="flag-h">
      <h2 id="unsorted-{uid}">Sin clasificar ({count})</h2>
      {#if online}
        <button type="button" class="flag-btn" onclick={onclassify}>Clasificar</button>
      {/if}
    </div>
    <ul class="rows">
      {@render children()}
    </ul>
  </section>
{/if}

<style>
  .flag {
    --row-line: color-mix(in srgb, var(--on-amber-soft) 18%, transparent);
    --row-meta: var(--on-amber-soft);
    margin: 0 12px 4px;
    padding: 0 6px 2px 14px;
    border-radius: var(--radius-block);
    background: var(--amber-soft);
    color: var(--on-amber-soft);
  }
  .flag-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 44px;
    padding-top: 4px;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  /* Visual height 36; the 44 px target comes from the transparent border area. */
  .flag-btn {
    position: relative;
    min-height: 36px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--amber);
    color: var(--on-amber);
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .flag-btn::before {
    content: '';
    position: absolute;
    inset: -4px 0;
  }
  .flag-btn:active {
    transform: scale(var(--press-scale));
  }
  .rows {
    margin: 0;
    padding: 0 8px 0 0;
    list-style: none;
  }
</style>
