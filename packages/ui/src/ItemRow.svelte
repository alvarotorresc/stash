<script lang="ts">
  import Icon from './icons/Icon.svelte';
  import Thumbnail from './Thumbnail.svelte';
  import type { IconName } from './icons/icons';
  import type { Tone } from './types';

  interface Props {
    title: string;
    /** Source and domain or account, for example "Reddit, r/askspain". */
    origin: string;
    /** Category name, shown after the origin in semibold. */
    category?: string;
    thumbnail?: { src?: string; tone?: Tone; icon?: IconName };
    /** Saved offline and waiting to upload: clock and a queued line instead of the origin. */
    queued?: boolean;
    /** Opens the reading view. The whole row is the target. */
    onopen: () => void;
  }

  let { title, origin, category, thumbnail, queued = false, onopen }: Props = $props();
</script>

<li class="row">
  <button type="button" class="hit" onclick={onopen}>
    <Thumbnail
      src={thumbnail?.src}
      tone={thumbnail?.tone}
      icon={queued ? 'schedule' : thumbnail?.icon}
    />
    <span class="tx">
      <span class="t">{title}</span>
      <span class="m">
        {#if queued}
          <span class="mi"><Icon name="schedule" size={15} /></span>En cola, se sube al volver la
          red
        {:else}
          {origin}{#if category}<b>{` · ${category}`}</b>{/if}
        {/if}
      </span>
    </span>
  </button>
</li>

<style>
  .row:not(:first-child) {
    border-top: 1px solid var(--row-line, var(--line));
  }
  .hit {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    width: 100%;
    min-height: 72px;
    padding: 12px 0;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .hit:active {
    transform: scale(var(--press-scale));
  }
  .hit:focus-visible {
    outline-offset: -2px;
    border-radius: var(--radius-control);
  }
  .tx {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }
  .t {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--fs-title);
    line-height: 1.3;
    font-weight: 600;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .m {
    margin-top: 3px;
    overflow: hidden;
    color: var(--row-meta, var(--muted));
    font-size: var(--fs-meta);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .m b {
    font-weight: 600;
  }
  .mi {
    display: inline-block;
    margin-right: 2px;
    vertical-align: -3px;
  }
</style>
