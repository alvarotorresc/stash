<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  interface Props extends HTMLButtonAttributes {
    children: Snippet;
    /** primary: one per screen at most. danger: destructive. */
    variant?: 'primary' | 'secondary' | 'danger';
    /**
     * Not available right now (for example, offline). Stays focusable and
     * readable, ignores presses; pair it with a line that says why.
     */
    unavailable?: boolean;
    icon?: IconName;
    /** Fill the width of the container. */
    block?: boolean;
  }

  let {
    children,
    variant = 'secondary',
    unavailable = false,
    icon,
    block = false,
    type = 'button',
    onclick,
    ...rest
  }: Props = $props();

  function handleClick(event: MouseEvent & { currentTarget: EventTarget & HTMLButtonElement }) {
    if (unavailable) {
      event.preventDefault();
      return;
    }
    onclick?.(event);
  }
</script>

<button
  {type}
  class="btn {variant}"
  class:unavailable
  class:block
  aria-disabled={unavailable ? 'true' : undefined}
  onclick={handleClick}
  {...rest}
>
  {#if icon}<Icon name={icon} size={20} />{/if}
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--ink);
    font-size: var(--fs-button);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .btn:active:not(.unavailable) {
    transform: scale(var(--press-scale));
  }
  .block {
    width: 100%;
  }
  .primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  .danger {
    color: var(--danger);
    border-color: currentColor;
  }
  /* No opacity: the text keeps its contrast; the dashed border says "not now". */
  .unavailable {
    background: transparent;
    border-color: var(--line-strong);
    border-style: dashed;
    color: var(--muted);
    font-weight: 600;
    cursor: not-allowed;
  }
  @media (hover: hover) and (pointer: fine) {
    .secondary:not(.unavailable):hover,
    .danger:not(.unavailable):hover {
      background: color-mix(in srgb, var(--ink) 6%, transparent);
    }
    .primary:not(.unavailable):hover {
      background: color-mix(in srgb, var(--accent) 88%, var(--ink));
    }
  }
</style>
