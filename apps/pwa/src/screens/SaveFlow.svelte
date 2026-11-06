<script lang="ts">
  import { SaveSheet, type Priority } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import type { Classification } from '../lib/service';

  const app = useApp();

  let tagQuery = $state('');
  // Keeps the last item while the sheet slides out.
  let last = $state<{ variant: 'saved' | 'queued' | 'classify'; itemId: string } | null>(null);

  $effect(() => {
    if (app.sheet) {
      last = app.sheet;
      tagQuery = '';
    }
  });

  const item = $derived(last ? app.item(last.itemId) : undefined);

  // Every change is kept at once: closing the sheet never loses what was touched.
  function change(classification: Classification) {
    if (item) void app.service.classify(item.id, classification);
  }

  async function createCategory(name: string) {
    const category = await app.service.createCategory(name);
    change({ categoryId: category.id });
  }
</script>

{#if last && item}
  <SaveSheet
    open={app.sheet !== null}
    variant={last.variant}
    title={item.title}
    thumbnail={item.thumbnail}
    priority={item.priority}
    categories={app.categories}
    category={item.categoryId}
    tags={item.tags}
    tagSuggestions={app.tagSuggestions(tagQuery, item.tags)}
    bind:tagQuery
    onpriority={(priority: Priority | null) => change({ priority })}
    oncategory={(categoryId) => change({ categoryId })}
    oncreatecategory={createCategory}
    ontagadd={(name) => change({ tags: [...item.tags, name] })}
    ontagremove={(name) => change({ tags: item.tags.filter((tag) => tag !== name) })}
    ondone={() => app.closeSheet()}
    onclose={() => app.closeSheet()}
  />
{/if}
