<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Group name above the block, for example "Tus datos". */
    title: string;
    /** SettingsRow elements. */
    children: Snippet;
  }

  let { title, children }: Props = $props();
  const uid = $props.id();
</script>

<section class="group" aria-labelledby="settings-{uid}">
  <h2 id="settings-{uid}">{title}</h2>
  <ul>
    {@render children()}
  </ul>
</section>

<style>
  .group {
    margin: 0 12px 20px;
  }
  h2 {
    margin: 0 0 6px 8px;
    color: var(--muted);
    font-size: var(--fs-label);
    font-weight: 600;
  }
  ul {
    margin: 0;
    padding: 0 14px;
    border-radius: var(--radius-block);
    background: var(--surface);
    list-style: none;
  }
</style>
