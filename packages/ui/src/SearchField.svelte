<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Icon from './icons/Icon.svelte';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type'> {
    /** Accessible name; the field shows only the icon and the text. */
    label: string;
    value?: string;
  }

  let { label, value = $bindable(''), ...rest }: Props = $props();
</script>

<label class="search">
  <span class="visually-hidden">{label}</span>
  <span class="ic"><Icon name="search" /></span>
  <input
    type="search"
    enterkeyhint="search"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    bind:value
    {...rest}
  />
</label>

<style>
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .ic {
    display: flex;
    color: var(--muted);
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: 46px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: var(--fs-input);
  }
  /* The box shows focus (border + ring); the input itself does not. */
  input:focus-visible {
    outline: none;
  }
  /* The browser's clear button brings its own colour; deleting the text is enough. */
  input::-webkit-search-decoration,
  input::-webkit-search-cancel-button {
    appearance: none;
  }
</style>
