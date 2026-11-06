<script lang="ts">
  import { tick } from 'svelte';
  import Chip from './Chip.svelte';
  import type { CategoryOption } from './types';

  interface Props {
    categories: CategoryOption[];
    selected: string | null;
    /** One category per item; pressing the active one clears it (null). */
    onselect: (id: string | null) => void;
    /** Creates a category from the inline field. */
    oncreate: (name: string) => void;
    label?: string;
  }

  let { categories, selected, onselect, oncreate, label = 'Categoría' }: Props = $props();
  const uid = $props.id();
  let creating = $state(false);
  let name = $state('');
  let input = $state<HTMLInputElement>();

  async function startCreating() {
    creating = true;
    await tick();
    input?.focus();
  }

  function create() {
    const trimmed = name.trim();
    if (trimmed) oncreate(trimmed);
    name = '';
    creating = false;
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') {
      event.preventDefault();
      create();
    } else if (event.key === 'Escape') {
      event.stopPropagation();
      name = '';
      creating = false;
    }
  }
</script>

<div class="wrap">
  <span class="label" id="cat-{uid}">{label}</span>
  <div class="chips" role="group" aria-labelledby="cat-{uid}">
    {#each categories as category (category.id)}
      <Chip
        selected={selected === category.id}
        onclick={() => onselect(selected === category.id ? null : category.id)}
      >
        {category.name}
      </Chip>
    {/each}
    {#if !creating}
      <Chip icon="add" onclick={startCreating}>Nueva</Chip>
    {/if}
  </div>
  {#if creating}
    <div class="new">
      <input
        bind:this={input}
        bind:value={name}
        aria-label="Nombre de la categoría nueva"
        enterkeyhint="done"
        autocomplete="off"
        {onkeydown}
      />
      <button type="button" class="add" onclick={create}>Añadir</button>
    </div>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .new {
    display: flex;
    gap: 8px;
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--fs-input);
  }
  input:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .add {
    min-height: 44px;
    padding: 0 14px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--ink);
    font-weight: 600;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
</style>
