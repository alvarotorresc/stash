<script lang="ts">
  import {
    ArticleContent,
    Button,
    EmptyState,
    PreviewContent,
    ReadingView,
    RedditContent,
    SubpageBar,
    TweetContent,
  } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { SOURCE_LABELS } from '../lib/format';
  import type { ItemDetail } from '../lib/service';

  interface Props {
    id: string;
  }

  let { id }: Props = $props();
  const app = useApp();

  let detail = $state<ItemDetail | null | undefined>(undefined);
  // The list copy stays current after classifying; the detail adds the content.
  const item = $derived(app.item(id));

  // The list copy changes when the page is read in the background or synced from
  // another device: the detail follows it.
  $effect(() => {
    void item;
    void app.service.getItem(id).then((loaded) => (detail = loaded));
  });

  const source = $derived(item ? SOURCE_LABELS[item.source] : '');
  const openLabel = $derived(item?.source === 'web' ? 'Abrir original' : `Abrir en ${source}`);
  const content = $derived(detail?.content);
  // The preview of Instagram and TikTok already has its own button to the original.
  const barLink = $derived(
    item && !(content?.kind === 'preview' && !content.blocked)
      ? { label: openLabel, href: item.url }
      : undefined,
  );

  const back = () => app.router.back();

  async function markRead() {
    if (await app.markRead(id)) back();
  }

  async function restore() {
    if (await app.restore(id)) back();
  }

  async function discard() {
    if (await app.discard(id)) back();
  }
</script>

{#if !item || detail === null}
  <SubpageBar onback={back} />
  <EmptyState
    title="Este guardado ya no está"
    text="Puede que lo hayas borrado desde otro dispositivo."
  />
  <div class="pad"><Button onclick={back}>Volver a Pendientes</Button></div>
{:else}
  <ReadingView
    barTitle={item.source === 'web' ? '' : source}
    link={barLink}
    category={app.categoryName(item.categoryId) ?? null}
    priority={item.priority}
    tags={item.tags}
    online={app.online}
    onback={back}
    onclassify={() => app.openSheet({ variant: 'classify', itemId: id })}
    ondiscard={discard}
    onmarkread={markRead}
    status={item.status}
    onrestore={restore}
  >
    {#if content?.kind === 'article'}
      <ArticleContent
        source={content.meta}
        title={item.title}
        image={content.image}
        html={content.html}
      />
    {:else if content?.kind === 'tweet'}
      <TweetContent
        author={content.author}
        html={content.html}
        images={content.images}
        date={content.date}
      />
    {:else if content?.kind === 'reddit'}
      <RedditContent source={content.meta} title={item.title} html={content.html} />
    {:else if content?.kind === 'preview'}
      <PreviewContent
        title={item.source === 'web' ? item.title : `${item.origin} en ${source}`}
        description={content.description}
        image={content.image}
        open={{ label: openLabel, href: item.url }}
        note={(item.source === 'instagram' || item.source === 'tiktok') && !content.blocked
          ? `De ${source}, Stash guarda la vista previa y el enlace.`
          : undefined}
        blocked={content.blocked
          ? {
              title: `${source} no ha dejado leer este post`,
              text: 'Tienes la vista previa y el enlace. Lo guardado no se pierde.',
            }
          : undefined}
      />
    {:else if content?.kind === 'none'}
      <PreviewContent
        title={item.title}
        description="Está en cola: se sube y se lee en cuanto vuelva la red."
        open={{ label: openLabel, href: item.url }}
      />
    {/if}
  </ReadingView>
{/if}

<style>
  .pad {
    padding: 16px 20px;
  }
</style>
