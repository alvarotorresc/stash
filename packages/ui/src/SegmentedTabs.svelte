<script lang="ts" generics="T extends string">
  interface Props {
    /** What the tabs switch, for the screen reader, for example "Estado". */
    label: string;
    tabs: { id: T; label: string }[];
    value: T;
    onchange: (value: T) => void;
    /** Prefix of the ids: the tab is `{idBase}-tab-{id}` and its panel `{idBase}-panel`. */
    idBase?: string;
  }

  const uid = $props.id();
  let { label, tabs, value, onchange, idBase = `tabs-${uid}` }: Props = $props();

  let list: HTMLDivElement | undefined = $state();

  // Arrows, Home and End move and select at once; only the active tab takes Tab.
  function onkeydown(event: KeyboardEvent) {
    const current = tabs.findIndex((tab) => tab.id === value);
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? (current + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (target < 0) return;
    event.preventDefault();
    onchange(tabs[target]!.id);
    list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  }
</script>

<div class="seg" role="tablist" aria-label={label} bind:this={list}>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      role="tab"
      id="{idBase}-tab-{tab.id}"
      aria-selected={value === tab.id}
      aria-controls="{idBase}-panel"
      tabindex={value === tab.id ? 0 : -1}
      {onkeydown}
      onclick={() => onchange(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .seg {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
  }
  button {
    min-height: 44px;
    padding: 0 8px;
    border: 0;
    border-left: 1px solid var(--line-strong);
    background: transparent;
    color: var(--ink);
    font-size: 15px;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  button:first-child {
    border-left: 0;
  }
  button:focus-visible {
    outline-offset: -4px;
  }
  button[aria-selected='true'] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
</style>
