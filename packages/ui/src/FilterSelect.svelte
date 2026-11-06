<script lang="ts" generics="T extends string">
  import Icon from './icons/Icon.svelte';

  interface Props {
    /** What it filters, for example "Estado". The chip shows the chosen option. */
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onchange: (value: T) => void;
    /** A filter is applied: soft green fill, like an active chip. */
    active?: boolean;
  }

  let { label, value, options, onchange, active = false }: Props = $props();

  // The native list opens as the system picker on Android: short, familiar, accessible.
  function handle(event: Event & { currentTarget: HTMLSelectElement }) {
    onchange(event.currentTarget.value as T);
  }
</script>

<span class="filter" class:on={active}>
  <select aria-label={label} {value} onchange={handle}>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
  <span class="ic"><Icon name="keyboard_arrow_down" size={18} /></span>
</span>

<style>
  .filter {
    position: relative;
    display: inline-flex;
    flex: none;
    align-items: center;
  }
  select {
    /* A native select cannot take a larger hit area than its box: 44 for the finger. */
    min-height: 44px;
    padding: 0 30px 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-chip);
    background: var(--surface);
    color: var(--ink);
    font-size: 14.5px;
    appearance: none;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .on select {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .ic {
    position: absolute;
    right: 8px;
    display: flex;
    color: var(--muted);
    pointer-events: none;
  }
</style>
