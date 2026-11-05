<script lang="ts">
  import Icon from '../icons/Icon.svelte';
  import RichText from './RichText.svelte';
  import type { SanitizedHtml } from '../types';

  interface Props {
    /** For example "r/askspain · u/carmen_rv". */
    source: string;
    title: string;
    html: SanitizedHtml;
  }

  let { source, title, html }: Props = $props();
</script>

<article>
  <p class="src">{source}</p>
  <h1>{title}</h1>
  <RichText {html} />
  <div class="note">
    <span class="ic"><Icon name="comments_disabled" size={20} /></span>
    <p>
      <b>Sin comentarios.</b> Stash guarda el post y su texto; los comentarios siguen en Reddit.
    </p>
  </div>
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
  .note {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    margin-top: 4px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .note p {
    margin: 0;
  }
  .note b {
    color: var(--ink);
  }
</style>
