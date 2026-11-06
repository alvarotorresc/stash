<script lang="ts">
  import type { Snippet } from 'svelte';
  import { BottomBar, type Tab } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';

  interface Props {
    active: Tab;
    children: Snippet;
  }

  let { active, children }: Props = $props();
  const app = useApp();

  const routes = {
    pending: { name: 'pending' },
    search: { name: 'search' },
    categories: { name: 'categories' },
  } as const;
</script>

<main class="content">
  {@render children()}
</main>
<BottomBar {active} onnavigate={(tab) => app.router.replace(routes[tab])} />

<style>
  .content {
    flex: 1;
    min-height: 0;
    padding-bottom: 24px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
</style>
