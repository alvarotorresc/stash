<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '../Button.svelte';
  import SubpageBar from '../SubpageBar.svelte';
  import Icon from '../icons/Icon.svelte';
  import { PRIORITY_LABELS, type Priority } from '../types';

  interface Props {
    /** Short name in the bar: "X", "Reddit", "Instagram" (empty for articles). */
    barTitle?: string;
    /** "Abrir original" or "Abrir en X". Hidden when the content has its own button. */
    link?: { label: string; href: string };
    category?: string | null;
    priority?: Priority | null;
    tags?: string[];
    /** Offline: reading works; marking and classifying wait for the network. */
    online?: boolean;
    onback: () => void;
    /** Opens the save sheet in classify mode. */
    onclassify: () => void;
    ondiscard: () => void;
    onmarkread: () => void;
    /** Where the item is now: read and discarded ones offer to go back to pending. */
    status?: 'pending' | 'read' | 'discarded';
    onrestore?: () => void;
    /** ArticleContent, TweetContent, RedditContent or PreviewContent. */
    children: Snippet;
  }

  let {
    barTitle = '',
    link,
    category = null,
    priority = null,
    tags = [],
    online = true,
    onback,
    onclassify,
    ondiscard,
    onmarkread,
    status = 'pending',
    onrestore,
    children,
  }: Props = $props();

  const uid = $props.id();
  const offlineId = `offline-${uid}`;
  const unclassified = $derived(!category && !priority && tags.length === 0);
</script>

<div class="screen">
  <SubpageBar title={barTitle} heading={false} {onback} {link} />
  <div class="read">
    {@render children()}
  </div>
  {#if online}
    <button type="button" class="props" onclick={onclassify}>
      <span class="visually-hidden">Clasificar:</span>
      {#if unclassified}
        <span class="chip"><Icon name="add" size={16} />Sin clasificar</span>
      {/if}
      {#if category}<span class="chip on">{category}</span>{/if}
      {#if priority}<span class="chip">{PRIORITY_LABELS[priority]}</span>{/if}
      {#each tags as tag (tag)}<span class="tag">{tag}</span>{/each}
    </button>
  {:else}
    <p class="props offline" id={offlineId}>
      <span class="ic"><Icon name="cloud_off" /></span>
      Sin conexión: lo puedes leer, pero marcar y clasificar esperan a la red.
    </p>
  {/if}
  <div class="bottom">
    {#if status === 'discarded'}
      <Button
        unavailable={!online}
        aria-describedby={online ? undefined : offlineId}
        onclick={onmarkread}>Marcar leído</Button
      >
    {:else}
      <Button
        unavailable={!online}
        aria-describedby={online ? undefined : offlineId}
        onclick={ondiscard}>Descartar</Button
      >
    {/if}
    {#if status === 'pending'}
      <Button
        variant="primary"
        unavailable={!online}
        aria-describedby={online ? undefined : offlineId}
        onclick={onmarkread}>Marcar leído</Button
      >
    {:else}
      <Button
        variant="primary"
        unavailable={!online}
        aria-describedby={online ? undefined : offlineId}
        onclick={onrestore}>Volver a pendientes</Button
      >
    {/if}
  </div>
</div>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  .read {
    flex: 1;
    min-height: 0;
    padding: 18px 20px 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .props {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin: 0;
    padding: 12px 20px;
    border: 0;
    border-top: 1px solid var(--line);
    background: transparent;
    color: var(--ink);
    text-align: left;
    font-size: inherit;
  }
  button.props {
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  button.props:focus-visible {
    outline-offset: -3px;
  }
  .offline {
    flex-wrap: nowrap;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-height: 40px;
    padding: 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-chip);
    font-size: 14.5px;
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }
  .tag {
    padding: 2px 8px;
    border-radius: var(--radius-chip);
    background: var(--accent-soft);
    font-size: 14px;
  }
  .bottom {
    display: flex;
    gap: 10px;
    padding: 12px 16px max(20px, env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  .bottom :global(.btn) {
    flex: 1;
  }
</style>
