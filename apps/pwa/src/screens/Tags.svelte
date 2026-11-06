<script lang="ts">
  import { CategoryList, EmptyState, InlineNotice, SubpageBar } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { attempt } from '../lib/attempt';
  import { savedCount } from '../lib/format';

  const app = useApp();
  let failed = $state<string | null>(null);

  const run = async (change: () => Promise<unknown>) => (failed = await attempt(change));
  const entries = $derived(app.tags.map((tag) => ({ id: tag.name, ...tag })));
</script>

<SubpageBar title="Etiquetas" onback={() => app.router.back({ name: 'settings' })} />
<main class="content">
  {#if entries.length === 0}
    <EmptyState
      title="Aún no tienes etiquetas"
      text="Se crean al clasificar un guardado, escribiéndolas en el campo de etiquetas."
    />
  {:else}
    <div class="body">
      {#if !app.online}
        <InlineNotice icon="cloud_off" title="Sin conexión">
          Para renombrar o borrar etiquetas hace falta red.
        </InlineNotice>
      {/if}
      <p class="cap">Se crean al guardar. Aquí solo se renombran o se borran.</p>
      {#if failed}<p class="cap error" role="alert">{failed}</p>{/if}
    </div>
    <CategoryList
      label="Etiquetas"
      items={entries}
      reorderable={false}
      onrename={(name, next) => run(() => app.service.renameTag(name, next))}
      ondelete={(name) => run(() => app.service.deleteTag(name))}
      deleteMessage={(entry) =>
        `Se quita de ${savedCount(entry.count)}. Los guardados no se borran.`}
    />
  {/if}
</main>

<style>
  .content {
    flex: 1;
    min-height: 0;
    padding-bottom: 24px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 20px 12px;
  }
  .cap {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .error {
    color: var(--danger);
  }
</style>
