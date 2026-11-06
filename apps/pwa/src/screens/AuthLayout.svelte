<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    lead: string;
    children: Snippet;
    /** Links under the form. */
    footer?: Snippet;
    /** The word Stash on top; left out under a back bar. */
    wordmark?: boolean;
  }

  let { title, lead, children, footer, wordmark = true }: Props = $props();
</script>

<main class="auth">
  {#if wordmark}<span class="word">Stash</span>{/if}
  <h1 class:first={!wordmark}>{title}</h1>
  <p class="lead">{lead}</p>
  {@render children()}
  {#if footer}<div class="foot">{@render footer()}</div>{/if}
</main>

<style>
  .auth {
    flex: 1;
    min-height: 0;
    padding: calc(24px + env(safe-area-inset-top, 0px)) 20px 32px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .word {
    font-size: var(--fs-word);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  h1 {
    margin: 28px 0 6px;
  }
  h1.first {
    margin-top: 0;
  }
  h1 {
    font-size: var(--fs-display);
    line-height: 1.15;
    letter-spacing: -0.025em;
  }
  .lead {
    margin: 0 0 24px;
    color: var(--muted);
    font-size: var(--fs-help);
    line-height: 1.45;
  }
  .foot {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    margin-top: 16px;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .foot :global(a) {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    color: var(--accent-text);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    touch-action: manipulation;
  }
</style>
