<script lang="ts">
  import Tag from './Tag.svelte';
  import type { TagSuggestion } from './types';

  const MAX_SUGGESTIONS = 4;

  interface Props {
    tags: string[];
    /** Matches for the current text among tags already used, sorted by use. */
    suggestions: TagSuggestion[];
    /** Text being typed; the caller filters suggestions from it. */
    query?: string;
    onquery?: (query: string) => void;
    onadd: (name: string) => void;
    onremove: (name: string) => void;
    label?: string;
  }

  let {
    tags,
    suggestions,
    query = $bindable(''),
    onquery,
    onadd,
    onremove,
    label = 'Etiquetas',
  }: Props = $props();

  const uid = $props.id();
  const listId = `tags-list-${uid}`;
  let focused = $state(false);
  let dismissed = $state(false);
  let active = $state(0);

  const shown = $derived(suggestions.slice(0, MAX_SUGGESTIONS));
  const open = $derived(focused && !dismissed && query.trim() !== '' && shown.length > 0);

  function setQuery(value: string) {
    query = value;
    active = 0;
    dismissed = false;
    onquery?.(value);
  }

  function add(name: string) {
    const trimmed = name.trim();
    if (trimmed && !tags.includes(trimmed)) onadd(trimmed);
    setQuery('');
  }

  function onkeydown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Enter':
      case ',': {
        const pick = open ? shown[active] : undefined;
        if (!pick && query.trim() === '') return;
        event.preventDefault();
        add(pick ? pick.name : query);
        break;
      }
      case 'ArrowDown':
        if (!open) return;
        event.preventDefault();
        active = (active + 1) % shown.length;
        break;
      case 'ArrowUp':
        if (!open) return;
        event.preventDefault();
        active = (active - 1 + shown.length) % shown.length;
        break;
      case 'Escape':
        if (!open) return;
        event.stopPropagation();
        dismissed = true;
        break;
      case 'Backspace': {
        const last = tags.at(-1);
        if (query === '' && last) onremove(last);
        break;
      }
    }
  }

  const uses = (count: number) => `en ${count} ${count === 1 ? 'guardado' : 'guardados'}`;
</script>

<div class="wrap">
  <label class="label" for="tags-{uid}">{label}</label>
  <div class="field" class:open>
    {#each tags as tag (tag)}
      <Tag name={tag} onremove={() => onremove(tag)} />
    {/each}
    <input
      id="tags-{uid}"
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open ? `${listId}-${active}` : undefined}
      autocomplete="off"
      autocapitalize="none"
      enterkeyhint="done"
      value={query}
      oninput={(event) => setQuery(event.currentTarget.value)}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      {onkeydown}
    />
  </div>
  <ul id={listId} role="listbox" aria-label="Etiquetas usadas" class="suggest" hidden={!open}>
    {#each shown as suggestion, index (suggestion.name)}
      <li
        id="{listId}-{index}"
        role="option"
        aria-selected={index === active}
        onpointerdown={(event) => {
          event.preventDefault();
          add(suggestion.name);
        }}
      >
        {suggestion.name}<small>{uses(suggestion.count)}</small>
      </li>
    {/each}
  </ul>
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
  }
  .label {
    margin-bottom: 6px;
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .field {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 48px;
    padding: 6px 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .field:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .field.open {
    border-radius: var(--radius-control) var(--radius-control) 0 0;
  }
  input {
    flex: 1;
    min-width: 6ch;
    min-height: 34px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--ink);
    font-size: var(--fs-input);
  }
  input:focus-visible {
    outline: none;
  }
  .suggest {
    margin: 0;
    padding: 0;
    overflow: hidden;
    list-style: none;
    border: 1px solid var(--line-strong);
    border-top: 0;
    border-radius: 0 0 var(--radius-control) var(--radius-control);
    background: var(--surface);
  }
  li {
    display: flex;
    align-items: center;
    min-height: 44px;
    padding: 0 12px;
    font-size: 15px;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
  }
  li + li {
    border-top: 1px solid var(--line);
  }
  li[aria-selected='true'] {
    background: var(--accent-soft);
  }
  small {
    margin-left: 8px;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
</style>
