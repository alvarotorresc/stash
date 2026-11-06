<script lang="ts">
  import type { SanitizedHtml } from '../types';

  interface Props {
    html: SanitizedHtml;
    /** tweet: tighter line height (1.45). */
    variant?: 'article' | 'tweet';
  }

  let { html, variant = 'article' }: Props = $props();
</script>

<div class="rich {variant}">
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- the prop type requires HTML sanitized by the caller -->
  {@html html}
</div>

<style>
  .rich {
    font-size: var(--fs-read);
    line-height: 1.6;
    overflow-wrap: break-word;
  }
  .tweet {
    line-height: 1.45;
  }
  .rich :global(p) {
    margin: 0 0 14px;
  }
  .rich :global(a) {
    color: var(--accent-text);
    text-underline-offset: 3px;
  }
  .rich :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-block);
  }
  .rich :global(h2),
  .rich :global(h3) {
    margin: 22px 0 8px;
    font-size: 20px;
    line-height: 1.3;
  }
  .rich :global(blockquote) {
    margin: 0 0 14px;
    padding-left: 14px;
    border-left: 2px solid var(--line-strong);
    color: var(--muted);
  }
  .rich :global(pre) {
    overflow-x: auto;
    padding: 12px;
    border-radius: var(--radius-control);
    background: var(--bg);
    font-size: 14px;
  }
  .rich :global(code) {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .rich :global(ul),
  .rich :global(ol) {
    margin: 0 0 14px;
    padding-left: 24px;
  }
</style>
