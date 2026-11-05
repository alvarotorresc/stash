<script lang="ts">
  import RichText from './RichText.svelte';
  import type { ImageData, SanitizedHtml } from '../types';

  interface Props {
    author: { name: string; handle: string };
    html: SanitizedHtml;
    images?: ImageData[];
    /** Already formatted, for example "14 oct. 2026, 18:02". */
    date: string;
  }

  let { author, html, images = [], date }: Props = $props();

  // Initials, never the real photo.
  const initials = $derived(
    author.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase())
      .join(''),
  );
</script>

<article>
  <div class="author">
    <span class="av" aria-hidden="true">{initials}</span>
    <div>
      <h1>{author.name}</h1>
      <span class="handle">{author.handle}</span>
    </div>
  </div>
  <div class="text"><RichText {html} variant="tweet" /></div>
  {#each images as image (image.src)}
    <img src={image.src} alt={image.alt} />
  {/each}
  <p class="date">{date}</p>
</article>

<style>
  .author {
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .av {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    background: var(--t1);
    font-size: 15px;
    font-weight: 700;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-title);
    font-weight: 700;
  }
  .handle {
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .text {
    margin: 14px 0 0;
  }
  img {
    display: block;
    width: 100%;
    margin-bottom: 10px;
    border-radius: var(--radius-block);
  }
  .date {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
</style>
