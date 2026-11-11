<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AccountForm,
    ArticleContent,
    Button,
    EmptyState,
    IconButton,
    Icon,
    InlineNotice,
    ItemList,
    ItemRow,
    PreviewContent,
    PrioritySegment,
    SelectField,
    Spinner,
    SubpageBar,
    TagInput,
    Thumbnail,
    type Priority,
    type TagSuggestion,
  } from '@stash/ui';
  import {
    AccountError,
    toHttpUrl,
    type Classification,
    type ItemDetail,
    type ListedItem,
    type Page,
    type PopupService,
    type SaveResult,
  } from '../../lib/service';

  interface Props {
    service: PopupService;
    /** Closing the popup never undoes anything. */
    onclose: () => void;
    /** Where Abrir Stash goes. */
    appUrl?: string;
  }

  let { service, onclose, appUrl = 'https://stash.alvarotc.com' }: Props = $props();

  type View =
    | { name: 'loading' }
    | { name: 'signed-out' }
    | { name: 'saving'; page: Page }
    | { name: 'saved'; item: SaveResult }
    | { name: 'unsupported' }
    | { name: 'list'; items: ListedItem[] | null; failed: boolean }
    | { name: 'reading'; id: string; detail: ItemDetail | null | undefined };

  let view = $state<View>({ name: 'loading' });
  let email = $state('');
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let categories = $state<{ id: string; name: string }[]>([]);
  let usedTags = $state<TagSuggestion[]>([]);
  let tagQuery = $state('');
  let saveFailed = $state(false);
  /** Where Volver goes from the list: the save, or nothing to go back to. */
  let home = $state<View>({ name: 'unsupported' });
  const suggestions = $derived.by(() => {
    const needle = tagQuery.trim().toLowerCase();
    const current = view.name === 'saved' ? view.item.tags : [];
    return needle
      ? usedTags.filter((tag) => tag.name.includes(needle) && !current.includes(tag.name))
      : [];
  });

  const ERRORS: Record<AccountError['code'], string> = {
    'invalid-credentials': 'El email o la contraseña no son correctos.',
    'rate-limited': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
    offline: 'Sin conexión. Para entrar hace falta red.',
    'no-access': 'Stash necesita permiso para hablar con stash.alvarotc.com. Acéptalo para entrar.',
  };
  const message = (failure: unknown) =>
    failure instanceof AccountError
      ? ERRORS[failure.code]
      : 'Algo ha fallado. Vuelve a intentarlo en un momento.';

  onMount(async () => {
    const session = await service.getSession();
    if (session) await afterUnlock();
    else {
      email = service.lastEmail() ?? '';
      view = { name: 'signed-out' };
    }
  });

  /** Links picked from the menu while locked are saved first, then the open tab. */
  async function afterUnlock() {
    await service.savePendingLinks().catch(() => 0);
    await saveTab();
  }

  async function saveTab() {
    const page = await service.currentTab();
    const url = toHttpUrl(page?.url);
    if (!page || !url) {
      view = { name: 'unsupported' };
      return;
    }
    // Title and domain come from the tab at once; the ring turns while it saves.
    view = { name: 'saving', page };
    saveFailed = false;
    try {
      const [item, loadedCategories, loadedTags] = await Promise.all([
        service.save({ ...page, url }),
        service.listCategories(),
        service.listTags(),
      ]);
      categories = loadedCategories;
      usedTags = loadedTags;
      view = { name: 'saved', item };
      home = view;
    } catch {
      saveFailed = true;
    }
  }

  async function submit() {
    if (view.name !== 'signed-out') return;
    if (!email.trim() || !password) {
      error = 'Escribe tu email y tu contraseña.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      await service.login(email, password);
      password = '';
      await afterUnlock();
    } catch (failure) {
      error = message(failure);
    } finally {
      busy = false;
    }
  }

  async function logout() {
    try {
      await service.logout();
    } catch {
      // The session may already be gone; the login screen is still the right place.
    }
    password = '';
    email = '';
    error = undefined;
    view = { name: 'signed-out' };
  }

  async function openList() {
    view = { name: 'list', items: null, failed: false };
    try {
      view = { name: 'list', items: await service.listItems(), failed: false };
    } catch {
      view = { name: 'list', items: null, failed: true };
    }
  }

  async function openItem(id: string) {
    view = { name: 'reading', id, detail: undefined };
    try {
      view = { name: 'reading', id, detail: await service.getItem(id) };
    } catch {
      view = { name: 'reading', id, detail: null };
    }
  }

  function change(classification: Classification) {
    if (view.name !== 'saved') return;
    view = { name: 'saved', item: { ...view.item, ...classification } };
    home = view;
    void service.classify(view.item.id, classification);
  }

  const categoryOptions = $derived([
    { value: '', label: 'Sin categoría' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ]);

  const domainOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !event.defaultPrevented) onclose();
  }
</script>

<svelte:window {onkeydown} />

<div class="popup">
  {#if view.name === 'list' || view.name === 'reading'}
    <!-- The list and the reading view bring their own bar. -->
  {:else}
    <header class="hd">
      <span class="word">Stash</span>
      <span class="hd-acts">
        {#if view.name !== 'loading' && view.name !== 'signed-out'}
          <IconButton icon="logout" label="Cerrar sesión" onclick={logout} />
        {/if}
        <IconButton icon="close" label="Cerrar" onclick={onclose} />
      </span>
    </header>
  {/if}

  {#if view.name === 'loading'}
    <p class="visually-hidden" role="status">Cargando</p>
  {:else if view.name === 'signed-out'}
    <h1 class="visually-hidden">Entrar</h1>
    <p class="lead">Entra para guardar páginas en tu Stash.</p>
    <AccountForm
      submitLabel="Entrar"
      passwordMode="current"
      bind:email
      bind:password
      {error}
      {busy}
      onsubmit={submit}
    />
    <p class="switch">
      ¿No tienes cuenta?
      <a class="link" href={appUrl} target="_blank" rel="noopener noreferrer">
        Créala en la web de Stash
      </a>
    </p>
  {:else if view.name === 'unsupported'}
    <h1 class="visually-hidden">Guardar página</h1>
    <InlineNotice icon="link_off" title="Esta página no se puede guardar">
      Stash guarda páginas web (las que empiezan por http o https).
    </InlineNotice>
    <div class="acts"><Button block onclick={openList}>Ver mi lista</Button></div>
  {:else if view.name === 'saving'}
    <h1 class="visually-hidden">Guardar página</h1>
    <div class="item" role="status">
      <Thumbnail tone={1} size={56} />
      <div class="tx">
        {#if saveFailed}
          <p class="state err">No se ha podido guardar</p>
        {:else}
          <p class="state"><Spinner />Guardando…</p>
        {/if}
        <p class="t">{view.page.title}</p>
        <p class="d">{domainOf(view.page.url)}</p>
      </div>
    </div>
    {#if saveFailed}
      <div class="acts"><Button variant="primary" block onclick={saveTab}>Reintentar</Button></div>
    {/if}
  {:else if view.name === 'saved'}
    {@const item = view.item}
    <h1 class="visually-hidden">Guardar página</h1>
    <div class="item">
      <Thumbnail src={item.thumbnail.src} tone={item.thumbnail.tone} size={56} />
      <div class="tx">
        <p class="state ok" role="status">
          <Icon name="check" size={20} />{item.alreadySaved ? 'Ya estaba guardado' : 'Guardado'}
        </p>
        <p class="t">{item.title}</p>
        <p class="d">{item.domain}</p>
      </div>
    </div>
    <div class="controls">
      <PrioritySegment
        value={item.priority}
        onchange={(priority: Priority | null) => change({ priority })}
      />
      <SelectField
        label="Categoría"
        value={item.categoryId ?? ''}
        options={categoryOptions}
        onchange={(value) => change({ categoryId: value || null })}
      />
      <TagInput
        tags={item.tags}
        {suggestions}
        bind:query={tagQuery}
        onadd={(name) => change({ tags: [...item.tags, name] })}
        onremove={(name) => change({ tags: item.tags.filter((tag) => tag !== name) })}
      />
    </div>
    <div class="acts">
      <Button onclick={openList}>Ver mi lista</Button>
      <Button variant="primary" onclick={onclose}>Listo</Button>
    </div>
    <a class="open" href={appUrl} target="_blank" rel="noopener noreferrer">Abrir Stash</a>
  {:else if view.name === 'list'}
    <SubpageBar title="Pendientes" onback={() => (view = home)} />
    {#if view.failed}
      <InlineNotice icon="cloud_off" title="No se ha podido cargar la lista">
        Revisa la conexión y vuelve a intentarlo.
      </InlineNotice>
      <div class="acts"><Button block onclick={openList}>Reintentar</Button></div>
    {:else if view.items === null}
      <p class="state" role="status"><Spinner />Cargando…</p>
    {:else if view.items.length === 0}
      <EmptyState title="No tienes nada pendiente" text="Lo que guardes aparece aquí." />
    {:else}
      <ItemList label="Pendientes">
        {#each view.items as listed (listed.id)}
          <ItemRow
            title={listed.title}
            origin={listed.origin}
            thumbnail={listed.thumbnail}
            queued={listed.queued}
            onopen={() => openItem(listed.id)}
          />
        {/each}
      </ItemList>
    {/if}
  {:else if view.name === 'reading'}
    {@const detail = view.detail}
    {#if detail === undefined}
      <SubpageBar onback={openList} heading={false} />
      <p class="state" role="status"><Spinner />Cargando…</p>
    {:else if detail === null}
      <SubpageBar onback={openList} heading={false} />
      <EmptyState
        title="Este guardado ya no está"
        text="Puede que lo hayas borrado desde otro dispositivo."
      />
    {:else}
      <SubpageBar
        onback={openList}
        heading={false}
        link={{ label: 'Abrir original', href: detail.url }}
      />
      <div class="read">
        {#if detail.content.kind === 'article'}
          <ArticleContent
            source={detail.content.meta}
            title={detail.title}
            html={detail.content.html}
          />
        {:else}
          <PreviewContent
            title={detail.title}
            description={detail.content.kind === 'preview' ? detail.content.description : undefined}
            open={{ label: 'Abrir original', href: detail.url }}
          />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  :global(body) {
    width: 380px;
  }
  .popup {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 8px 20px 20px;
  }
  .hd-acts {
    display: flex;
    align-items: center;
  }
  .read {
    max-height: 420px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-right: -12px;
  }
  .word {
    font-size: var(--fs-word);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
  p {
    margin: 0;
  }
  .lead,
  .switch {
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .link {
    min-height: 44px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font-size: inherit;
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
  }
  .tx {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .ok {
    color: var(--accent-text);
  }
  .err {
    color: var(--danger);
  }
  .t {
    font-size: var(--fs-title);
    font-weight: 600;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .d {
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .acts {
    display: flex;
    gap: 10px;
  }
  .acts > :global(*) {
    flex: 1;
  }
  .open {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 48px;
    padding: 0 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    color: var(--ink);
    font-size: var(--fs-button);
    font-weight: 600;
    text-decoration: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .open:hover,
    .link:hover {
      background: color-mix(in srgb, var(--ink) 6%, transparent);
    }
  }
</style>
