<script lang="ts">
  import { PRIORITIES } from '@stash/core';
  import { PRIORITY_LABELS, type Priority } from './types';

  interface Props {
    value: Priority | null;
    /** Pressing the active segment clears it (null). */
    onchange: (value: Priority | null) => void;
    label?: string;
  }

  let { value, onchange, label = 'Prioridad' }: Props = $props();
  const uid = $props.id();
</script>

<div class="wrap">
  <span class="label" id="prio-{uid}">{label}</span>
  <div class="seg" role="group" aria-labelledby="prio-{uid}">
    {#each PRIORITIES as priority (priority)}
      <button
        type="button"
        aria-pressed={value === priority}
        onclick={() => onchange(value === priority ? null : priority)}
      >
        {PRIORITY_LABELS[priority]}
      </button>
    {/each}
  </div>
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
  .seg {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
  }
  button {
    min-height: 44px;
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
  button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
</style>
