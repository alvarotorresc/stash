<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  interface Props {
    /** cloud_off for no connection, link_off for a blocked source. */
    icon: IconName;
    title: string;
    children: Snippet;
  }

  let { icon, title, children }: Props = $props();
</script>

<div class="banner" role="status">
  <span class="ic"><Icon name={icon} /></span>
  <div>
    <p class="h">{title}</p>
    <p class="b">{@render children()}</p>
  </div>
</div>

<style>
  .banner {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-block);
    background: var(--surface);
    color: var(--ink);
  }
  .ic {
    color: var(--muted);
  }
  p {
    margin: 0;
  }
  .h {
    font-size: 15px;
    font-weight: 700;
  }
  .b {
    margin-top: 2px;
    color: var(--muted);
    font-size: var(--fs-help);
  }
</style>
