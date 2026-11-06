<script lang="ts">
  import IconButton from './IconButton.svelte';
  import Icon from './icons/Icon.svelte';

  interface Props {
    title?: string;
    onback: () => void;
    /** Renders the title as the page heading (h1). */
    heading?: boolean;
    /** External link on the right, for example "Abrir original" or "Abrir en X". */
    link?: { label: string; href: string };
  }

  let { title = '', onback, heading = true, link }: Props = $props();
</script>

<div class="bar">
  <IconButton icon="arrow_back" label="Volver" onclick={onback} />
  {#if heading}
    <h1 class="bt">{title}</h1>
  {:else}
    <span class="bt">{title}</span>
  {/if}
  {#if link}
    <a class="lnk" href={link.href} target="_blank" rel="noopener noreferrer">
      {link.label}<Icon name="open_in_new" size={18} />
    </a>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    min-height: 52px;
    padding: env(safe-area-inset-top, 0px) 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .bt {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding-left: 2px;
    overflow: hidden;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .lnk {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: var(--radius-control);
    color: var(--accent-text);
    font-size: 15px;
    font-weight: 600;
    text-decoration: none;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .lnk:hover {
      text-decoration: underline;
      text-underline-offset: 3px;
    }
  }
</style>
