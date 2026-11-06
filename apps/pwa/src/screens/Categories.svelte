<script lang="ts">
  import { Button, CategoryList, InlineNotice, ScreenTitle, TextField } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { attempt } from '../lib/attempt';
  import { savedCount } from '../lib/format';
  import TabLayout from './TabLayout.svelte';

  const app = useApp();
  let name = $state('');
  let failed = $state<string | null>(null);

  const run = async (change: () => Promise<unknown>) => (failed = await attempt(change));

  async function add(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    await run(() => app.service.createCategory(trimmed));
    if (!failed) name = '';
  }

  const deleteMessage = (entry: { count: number }) =>
    entry.count === 0
      ? 'No tiene guardados. No se pierde nada.'
      : `Sus ${savedCount(entry.count)} pasan a Sin clasificar. No se pierde nada.`;
</script>

<TabLayout active="categories">
  <div class="title"><ScreenTitle title="Categorías" /></div>
  <div class="body">
    {#if !app.online}
      <InlineNotice icon="cloud_off" title="Sin conexión">
        Para crear, ordenar o cambiar categorías hace falta red.
      </InlineNotice>
    {/if}
    <form class="add" onsubmit={add}>
      <TextField label="Nueva categoría" bind:value={name} enterkeyhint="done" />
      <Button type="submit" unavailable={!app.online}>Añadir</Button>
    </form>
    {#if failed}<p class="error" role="alert">{failed}</p>{/if}
    {#if app.categories.length > 0}
      <p class="cap">Arrastra para ordenar. Las de arriba salen antes en Pendientes.</p>
    {:else}
      <p class="cap">Aún no tienes categorías. Crea una aquí o al clasificar un guardado.</p>
    {/if}
  </div>
  {#if app.categories.length > 0}
    <CategoryList
      label="Categorías"
      items={app.categories}
      onreorder={(ids) => run(() => app.service.reorderCategories(ids))}
      onrename={(id, next) => run(() => app.service.renameCategory(id, next))}
      ondelete={(id) => run(() => app.service.deleteCategory(id))}
      {deleteMessage}
    />
  {/if}
</TabLayout>

<style>
  /* No app header on this tab: the title keeps clear of the status bar. */
  .title {
    padding-top: calc(16px + env(safe-area-inset-top, 0px));
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 0 20px 12px;
  }
  .add {
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  .add > :global(:first-child) {
    flex: 1;
  }
  .cap,
  .error {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .error {
    color: var(--danger);
  }
</style>
