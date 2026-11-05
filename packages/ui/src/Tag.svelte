<script lang="ts">
  import Icon from './icons/Icon.svelte';

  interface Props {
    name: string;
    /** Shows a × to remove the tag. */
    onremove?: () => void;
  }

  let { name, onremove }: Props = $props();
</script>

<span class="tag" class:removable={!!onremove}>
  {name}
  {#if onremove}
    <button type="button" class="x" aria-label="Quitar {name}" onclick={onremove}>
      <Icon name="close" size={16} />
    </button>
  {/if}
</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border-radius: var(--radius-chip);
    background: var(--accent-soft);
    color: var(--ink);
    font-size: 14px;
    line-height: 1.4;
  }
  .removable {
    padding-right: 2px;
  }
  /* Visible 20 px; the 44 px target extends over the field padding. */
  .x {
    position: relative;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ink);
    cursor: pointer;
    touch-action: manipulation;
  }
  .x::before {
    content: '';
    position: absolute;
    inset: -12px;
  }
</style>
