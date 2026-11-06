<script lang="ts">
  import RichText from './RichText.svelte';
  import type { ImageData, SanitizedHtml } from '../types';

  interface Props {
    /** For example "lacocinaordenada.es · 6 min". */
    source: string;
    title: string;
    image?: ImageData;
    html: SanitizedHtml;
  }

  let { source, title, image, html }: Props = $props();
</script>

<article>
  <p class="src">{source}</p>
  <h1>{title}</h1>
  {#if image}<img class="hero" src={image.src} alt={image.alt} />{/if}
  <RichText {html} />
</article>

<style>
  .src {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  h1 {
    margin: 6px 0 8px;
    font-size: var(--fs-read-title);
    line-height: 1.18;
    letter-spacing: -0.02em;
    font-weight: 700;
  }
  .hero {
    display: block;
    width: 100%;
    margin: 4px 0 16px;
    border-radius: var(--radius-block);
  }
</style>
