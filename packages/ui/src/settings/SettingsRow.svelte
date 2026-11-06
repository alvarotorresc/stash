<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import type { IconName } from '../icons/icons';

  interface Props {
    icon: IconName;
    label: string;
    /** One line under the label that says what happens. */
    description?: string;
    /** For example how many categories there are. */
    count?: number;
    /** Without onclick the row is plain information (the account). */
    onclick?: () => void;
    /** Opens another screen: shows a chevron. */
    chevron?: boolean;
  }

  let { icon, label, description, count, onclick, chevron = false }: Props = $props();
</script>

{#snippet content()}
  <span class="ic"><Icon name={icon} /></span>
  <span class="tx">
    <span class="l">{label}</span>
    {#if description}<span class="d">{description}</span>{/if}
  </span>
  {#if count !== undefined}<span class="n">{count}</span>{/if}
  {#if chevron}<span class="ic"><Icon name="chevron_right" /></span>{/if}
{/snippet}

<li class="row">
  {#if onclick}
    <button type="button" class="in hit" {onclick}>{@render content()}</button>
  {:else}
    <div class="in">{@render content()}</div>
  {/if}
</li>

<style>
  .row:not(:first-child) {
    border-top: 1px solid var(--line);
  }
  .in {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 56px;
    padding: 10px 0;
    color: var(--ink);
    text-align: left;
  }
  .hit {
    border: 0;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .hit:active {
    transform: scale(var(--press-scale));
  }
  .hit:focus-visible {
    outline-offset: -2px;
    border-radius: var(--radius-control);
  }
  .ic {
    display: flex;
    flex: none;
    color: var(--muted);
  }
  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
  }
  .l {
    font-size: var(--fs-title);
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .d {
    margin-top: 2px;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .n {
    color: var(--muted);
    font-size: 14px;
  }
</style>
