<script lang="ts">
  import {
    AppHeader,
    Button,
    EmptyState,
    GroupHeader,
    InlineNotice,
    ItemList,
    ItemRow,
    LoadingRows,
    PRIORITY_LABELS,
    ScreenTitle,
    UnsortedStrip,
  } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { originLabel } from '../lib/format';
  import { groupPending } from '../lib/pending';
  import type { Item } from '../lib/service';
  import TabLayout from './TabLayout.svelte';

  const app = useApp();

  const view = $derived(groupPending(app.items, app.categories));
  const subtitle = $derived(
    app.loading ? 'Cargando…' : view.total === 0 ? 'Nada por leer' : `${view.total} por leer`,
  );

  const open = (item: Item) => app.router.go({ name: 'item', id: item.id });

  function classifyFirst() {
    const first = view.unsorted.find((item) => !item.queued);
    if (first) app.openSheet({ variant: 'classify', itemId: first.id });
  }
</script>

<AppHeader onsettings={() => app.router.go({ name: 'settings' })} />
<TabLayout active="pending">
  <ScreenTitle title="Pendientes" {subtitle} />

  {#if !app.online}
    <div class="notice">
      <InlineNotice icon="cloud_off" title="Sin conexión">
        Puedes leer lo ya descargado. Para clasificar o marcar hace falta red.
      </InlineNotice>
    </div>
  {/if}

  {#if app.loadFailed}
    <div class="notice">
      <InlineNotice icon="cloud_off" title="No se han podido cargar tus guardados">
        Lo guardado no se ha perdido. Vuelve a intentarlo en un momento.
      </InlineNotice>
      <Button onclick={() => app.refresh()}>Reintentar</Button>
    </div>
  {:else if app.loading && app.items.length === 0}
    <LoadingRows />
  {:else if view.total === 0}
    <EmptyState
      title="Lo tienes todo leído"
      text="Comparte un enlace a Stash desde cualquier app del móvil, o guarda una página con la extensión del navegador."
    />
  {:else}
    <UnsortedStrip count={view.unsorted.length} online={app.online} onclassify={classifyFirst}>
      {#each view.unsorted as item (item.id)}
        <ItemRow
          title={item.title}
          origin={originLabel(item)}
          category={app.categoryName(item.categoryId)}
          thumbnail={item.thumbnail}
          queued={item.queued}
          onopen={() => open(item)}
        />
      {/each}
    </UnsortedStrip>

    {#each view.groups as group (group.priority)}
      {@const name = PRIORITY_LABELS[group.priority]}
      <GroupHeader {name} count={group.items.length} />
      <ItemList label={name}>
        {#each group.items as item (item.id)}
          <ItemRow
            title={item.title}
            origin={originLabel(item)}
            category={app.categoryName(item.categoryId)}
            thumbnail={item.thumbnail}
            onopen={() => open(item)}
          />
        {/each}
      </ItemList>
    {/each}
  {/if}
</TabLayout>

<style>
  .notice {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    margin: 0 12px 12px;
  }
  .notice > :global(*:first-child) {
    align-self: stretch;
  }
</style>
