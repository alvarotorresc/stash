<script lang="ts">
  import {
    EmptyState,
    FilterSelect,
    ItemList,
    ItemRow,
    PRIORITY_LABELS,
    SearchField,
    type Priority,
  } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { SOURCE_LABELS, originLabel } from '../lib/format';
  import type { SearchFilters, SearchResult, Source, Status } from '../lib/service';
  import TabLayout from './TabLayout.svelte';

  const app = useApp();

  let query = $state('');
  let status = $state<Status | 'all'>('pending');
  let source = $state<Source | 'all'>('all');
  let category = $state('all');
  let priority = $state<Priority | 'all'>('all');
  let results = $state<SearchResult[]>([]);
  let searched = $state(false);

  const statusOptions: { value: Status | 'all'; label: string }[] = [
    { value: 'pending', label: 'Pendientes' },
    { value: 'read', label: 'Leídos' },
    { value: 'discarded', label: 'Descartados' },
    { value: 'all', label: 'Cualquier estado' },
  ];
  const sourceOptions: { value: Source | 'all'; label: string }[] = [
    { value: 'all', label: 'Origen' },
    ...(Object.keys(SOURCE_LABELS) as Source[]).map((value) => ({
      value,
      label: SOURCE_LABELS[value],
    })),
  ];
  const priorityOptions: { value: Priority | 'all'; label: string }[] = [
    { value: 'all', label: 'Prioridad' },
    ...(Object.keys(PRIORITY_LABELS) as Priority[]).map((value) => ({
      value,
      label: PRIORITY_LABELS[value],
    })),
  ];
  const categoryOptions = $derived([
    { value: 'all', label: 'Categoría' },
    ...app.categories.map((entry) => ({ value: entry.id, label: entry.name })),
    { value: 'none', label: 'Sin categoría' },
  ]);

  let latest = 0;
  $effect(() => {
    const filters: SearchFilters = { query, status, source, category, priority };
    void app.items;
    const ticket = ++latest;
    void app.service.search(filters).then((found) => {
      // Only the answer to the last search counts.
      if (ticket !== latest) return;
      results = found;
      searched = true;
    });
  });

  const where = $derived(query.trim() ? ' en título y texto' : '');
  const countLine = $derived(
    `${results.length} ${results.length === 1 ? 'resultado' : 'resultados'}${where}`,
  );

  /** Category and priority after the origin, as in the design: "· Madrid · Alta". */
  function extra(result: SearchResult) {
    const parts = [
      app.categoryName(result.item.categoryId),
      result.item.priority ? PRIORITY_LABELS[result.item.priority] : undefined,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  }
</script>

<TabLayout active="search">
  <h1 class="visually-hidden">Buscar</h1>
  <div class="top">
    <SearchField label="Buscar en tus guardados" placeholder="Buscar" bind:value={query} />
  </div>
  <div class="filters" role="group" aria-label="Filtros">
    <FilterSelect
      label="Estado"
      value={status}
      options={statusOptions}
      active={status !== 'pending'}
      onchange={(value) => (status = value)}
    />
    <FilterSelect
      label="Origen"
      value={source}
      options={sourceOptions}
      active={source !== 'all'}
      onchange={(value) => (source = value)}
    />
    <FilterSelect
      label="Categoría"
      value={category}
      options={categoryOptions}
      active={category !== 'all'}
      onchange={(value) => (category = value)}
    />
    <FilterSelect
      label="Prioridad"
      value={priority}
      options={priorityOptions}
      active={priority !== 'all'}
      onchange={(value) => (priority = value)}
    />
  </div>

  {#if searched}
    {#if results.length === 0}
      <EmptyState
        title="Nada coincide"
        text="Prueba con otra palabra o quita algún filtro. La búsqueda mira el título y el texto."
      />
    {:else}
      <p class="count" role="status">{countLine}</p>
      <ItemList label="Resultados">
        {#each results as result (result.item.id)}
          <ItemRow
            title={result.item.title}
            origin={originLabel(result.item)}
            category={extra(result)}
            thumbnail={result.item.thumbnail}
            queued={result.item.queued}
            snippet={result.snippet}
            highlight={query}
            onopen={() => app.router.go({ name: 'item', id: result.item.id })}
          />
        {/each}
      </ItemList>
    {/if}
  {/if}
</TabLayout>

<style>
  .top {
    padding: calc(12px + env(safe-area-inset-top, 0px)) 12px 8px;
  }
  .filters {
    display: flex;
    gap: 8px;
    padding: 4px 12px 8px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .count {
    margin: 4px 20px 8px;
    color: var(--muted);
    font-size: var(--fs-help);
  }
</style>
