<script lang="ts">
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  interface Props extends HTMLButtonAttributes {
    icon: IconName;
    /** Accessible name; the button shows only the icon. */
    label: string;
  }

  let { icon, label, type = 'button', ...rest }: Props = $props();
</script>

<button {type} class="ib" aria-label={label} {...rest}>
  <Icon name={icon} />
</button>

<style>
  .ib {
    display: grid;
    place-items: center;
    width: var(--target);
    height: var(--target);
    flex: none;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .ib:active {
    transform: scale(var(--press-scale));
  }
  @media (hover: hover) and (pointer: fine) {
    .ib:hover {
      background: color-mix(in srgb, var(--ink) 8%, transparent);
    }
  }
</style>
