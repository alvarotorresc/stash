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
    SegmentedTabs,
    UnsortedStrip,
  } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { originLabel } from '../lib/format';
  import { groupPending } from '../lib/pending';
  import type { Item, Status } from '../lib/service';
  import TabLayout from './TabLayout.svelte';

  const app = useApp();

  const TABS: { id: Status; label: string }[] = [
    { id: 'pending', label: 'Pendientes' },
    { id: 'read', label: 'Leídos' },
    { id: 'discarded', label: 'Descartados' },
  ];
  const EMPTY = {
    read: {
      title: 'Aún no has leído nada',
      text: 'Lo que marques como leído se queda aquí, por si quieres volver a ello.',
    },
    discarded: {
      title: 'No has descartado nada',
      text: 'Lo que descartes no se pierde: lo encontrarás aquí.',
    },
  } as const;

  const tab = $derived(app.homeTab);
  const title = $derived(TABS.find((entry) => entry.id === tab)?.label ?? 'Pendientes');
  const view = $derived(groupPending(app.items, app.categories));
  // Read and discarded: the most recently closed first. The saved date stands in for an item
  // that never recorded a change.
  const closed = $derived(
    tab === 'pending'
      ? []
      : app.items
          .filter((item) => item.status === tab)
          .sort((a, b) => (b.statusChangedAt ?? b.savedAt) - (a.statusChangedAt ?? a.savedAt)),
  );
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
  <div class="tabs">
    <SegmentedTabs
      label="Estado"
      idBase="home"
      tabs={TABS}
      value={tab}
      onchange={(value) => (app.homeTab = value)}
    />
  </div>
  <ScreenTitle {title} {subtitle} />

  {#if !app.online}
    <div class="notice">
      <InlineNotice icon="cloud_off" title="Sin conexión">
        Puedes leer lo ya descargado. Para clasificar o marcar hace falta red.
      </InlineNotice>
    </div>
  {/if}

  <div role="tabpanel" id="home-panel" aria-labelledby="home-tab-{tab}">
    {#if app.loadFailed}
      <div class="notice">
        <InlineNotice icon="cloud_off" title="No se han podido cargar tus guardados">
          Lo guardado no se ha perdido. Vuelve a intentarlo en un momento.
        </InlineNotice>
        <Button onclick={() => app.refresh()}>Reintentar</Button>
      </div>
    {:else if app.loading && app.items.length === 0}
      <LoadingRows />
    {:else if tab !== 'pending'}
      {#if closed.length === 0}
        <EmptyState title={EMPTY[tab].title} text={EMPTY[tab].text} />
      {:else}
        <ItemList label={title}>
          {#each closed as item (item.id)}
            <ItemRow
              title={item.title}
              origin={originLabel(item)}
              category={app.categoryName(item.categoryId)}
              thumbnail={item.thumbnail}
              onopen={() => open(item)}
            />
          {/each}
        </ItemList>
      {/if}
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
  </div>
</TabLayout>

<style>
  .tabs {
    padding: calc(12px + env(safe-area-inset-top, 0px)) 12px 4px;
  }
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
