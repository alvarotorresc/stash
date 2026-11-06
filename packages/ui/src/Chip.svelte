<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  interface Props {
    children: Snippet;
    /** Active: soft green fill and accent border. */
    selected?: boolean;
    icon?: IconName;
    /** Without onclick the chip is plain text (for example, in the reading view). */
    onclick?: () => void;
  }

  let { children, selected = false, icon, onclick }: Props = $props();
</script>

{#if onclick}
  <button type="button" class="chip" class:on={selected} aria-pressed={selected} {onclick}>
    {#if icon}<Icon name={icon} size={18} />{/if}
    {@render children()}
  </button>
{:else}
  <span class="chip" class:on={selected}>
    {#if icon}<Icon name={icon} size={18} />{/if}
    {@render children()}
  </span>
{/if}

<style>
  .chip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-chip);
    background: transparent;
    color: var(--ink);
    font-size: 14.5px;
    white-space: nowrap;
    flex: none;
    user-select: none;
    -webkit-user-select: none;
  }
  button.chip {
    cursor: pointer;
    touch-action: manipulation;
    transition: transform var(--dur-press) var(--ease-out);
  }
  /* Visual height 40; the target grows to 44. */
  button.chip::before {
    content: '';
    position: absolute;
    inset: -3px 0;
  }
  button.chip:active {
    transform: scale(var(--press-scale));
  }
  .on {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
