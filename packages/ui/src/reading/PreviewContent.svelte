<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import InlineNotice from '../InlineNotice.svelte';
  import type { ImageData } from '../types';

  interface Props {
    title: string;
    description?: string;
    image?: ImageData;
    /** Button to the original, for example "Abrir en Instagram". */
    open: { label: string; href: string };
    /** Why there is only a preview, for example Instagram's note. */
    note?: string;
    /** The source blocked reading: notice above the preview. */
    blocked?: { title: string; text: string };
  }

  let { title, description, image, open, note, blocked }: Props = $props();
</script>

<article>
  {#if blocked}
    <div class="gap">
      <InlineNotice icon="link_off" title={blocked.title}>{blocked.text}</InlineNotice>
    </div>
  {/if}
  <div class="preview">
    {#if image}<img src={image.src} alt={image.alt} />{/if}
    <div class="pv">
      <h1>{title}</h1>
      {#if description}<p>{description}</p>{/if}
    </div>
  </div>
  <a class="open" href={open.href} target="_blank" rel="noopener noreferrer">
    <Icon name="open_in_new" size={20} />{open.label}
  </a>
  {#if note}<p class="help">{note}</p>{/if}
</article>

<style>
  .gap {
    margin-bottom: 14px;
  }
  .preview {
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--radius-block);
    background: var(--surface);
  }
  img {
    display: block;
    width: 100%;
    max-height: 300px;
    object-fit: cover;
  }
  .pv {
    padding: 12px 14px 14px;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    line-height: 1.3;
    font-weight: 700;
  }
  .pv p {
    margin: 4px 0 0;
    color: var(--muted);
    font-size: 14.5px;
    line-height: 1.45;
  }
  .open {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 48px;
    margin-top: 14px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--ink);
    font-size: var(--fs-button);
    font-weight: 600;
    text-decoration: none;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    transition: transform var(--dur-press) var(--ease-out);
  }
  .open:active {
    transform: scale(var(--press-scale));
  }
  .help {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: var(--fs-help);
    line-height: 1.4;
  }
</style>
