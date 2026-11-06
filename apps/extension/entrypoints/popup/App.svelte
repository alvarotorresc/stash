<script lang="ts">
  import { onMount } from 'svelte';
  import {
    AccountForm,
    Button,
    IconButton,
    Icon,
    InlineNotice,
    PrioritySegment,
    RecoveryCodeScreen,
    SelectField,
    Spinner,
    TagInput,
    Thumbnail,
    type Priority,
    type TagSuggestion,
  } from '@stash/ui';
  import {
    AccountError,
    toHttpUrl,
    type Classification,
    type Page,
    type PopupService,
    type SavedItem,
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
    | { name: 'signed-out'; mode: 'login' | 'register' }
    | { name: 'recovery'; code: string }
    | { name: 'saving'; page: Page }
    | { name: 'saved'; item: SavedItem }
    | { name: 'unsupported' };

  let view = $state<View>({ name: 'loading' });
  let email = $state('');
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let copied = $state(false);
  let confirmed = $state(false);
  let categories = $state<{ id: string; name: string }[]>([]);
  let usedTags = $state<TagSuggestion[]>([]);
  let tagQuery = $state('');
  let saveFailed = $state(false);

  const strength = $derived(
    view.name === 'signed-out' && view.mode === 'register'
      ? service.passwordStrength(password)
      : null,
  );
  const suggestions = $derived.by(() => {
    const needle = tagQuery.trim().toLowerCase();
    const current = view.name === 'saved' ? view.item.tags : [];
    return needle
      ? usedTags.filter((tag) => tag.name.includes(needle) && !current.includes(tag.name))
      : [];
  });

  const ERRORS: Record<AccountError['code'], string> = {
    'invalid-credentials': 'El email o la contraseña no son correctos.',
    'email-taken': 'Ese email ya tiene cuenta. Entra con él o usa otro.',
    'weak-password': 'Elige una contraseña de al menos 10 caracteres que no sea muy común.',
    offline: 'Sin conexión. Para entrar o crear la cuenta hace falta red.',
  };
  const message = (failure: unknown) =>
    failure instanceof AccountError
      ? ERRORS[failure.code]
      : 'Algo ha fallado. Vuelve a intentarlo en un momento.';

  onMount(async () => {
    const session = await service.getSession();
    if (session) await saveTab();
    else {
      email = service.lastEmail() ?? '';
      view = { name: 'signed-out', mode: 'login' };
    }
  });

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
        service.save({ url, title: page.title }),
        service.listCategories(),
        service.listTags(),
      ]);
      categories = loadedCategories;
      usedTags = loadedTags;
      view = { name: 'saved', item };
    } catch {
      saveFailed = true;
    }
  }

  async function submit() {
    if (view.name !== 'signed-out') return;
    const registering = view.mode === 'register';
    if (!email.trim() || !password) {
      error = 'Escribe tu email y tu contraseña.';
      return;
    }
    if (registering && (password.length < 10 || strength?.blocked)) {
      error = ERRORS['weak-password'];
      return;
    }
    busy = true;
    error = undefined;
    try {
      if (registering) {
        const { recoveryCode } = await service.register(email, password);
        view = { name: 'recovery', code: recoveryCode };
      } else {
        await service.login(email, password);
        await saveTab();
      }
    } catch (failure) {
      error = message(failure);
    } finally {
      busy = false;
    }
  }

  function switchMode(mode: 'login' | 'register') {
    error = undefined;
    password = '';
    view = { name: 'signed-out', mode };
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function downloadCode(code: string) {
    const text = `Código de recuperación de Stash\n\n${code}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stash-codigo-de-recuperacion.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  function change(classification: Classification) {
    if (view.name !== 'saved') return;
    view = { name: 'saved', item: { ...view.item, ...classification } };
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
  <header class="hd">
    <span class="word">Stash</span>
    <IconButton icon="close" label="Cerrar" onclick={onclose} />
  </header>

  {#if view.name === 'loading'}
    <p class="visually-hidden" role="status">Cargando</p>
  {:else if view.name === 'signed-out'}
    <h1 class="visually-hidden">{view.mode === 'login' ? 'Entrar' : 'Crear cuenta'}</h1>
    <p class="lead">
      {view.mode === 'login'
        ? 'Entra para guardar páginas en tu Stash.'
        : 'Tu contraseña también cifra lo que guardas. El servidor no puede leerlo.'}
    </p>
    <AccountForm
      submitLabel={view.mode === 'login' ? 'Entrar' : 'Crear cuenta'}
      passwordMode={view.mode === 'login' ? 'current' : 'new'}
      bind:email
      bind:password
      {strength}
      {error}
      {busy}
      onsubmit={submit}
    />
    <p class="switch">
      {#if view.mode === 'login'}
        ¿No tienes cuenta?
        <button type="button" class="link" onclick={() => switchMode('register')}>
          Crear cuenta
        </button>
      {:else}
        ¿Ya tienes cuenta?
        <button type="button" class="link" onclick={() => switchMode('login')}>Entrar</button>
      {/if}
    </p>
  {:else if view.name === 'recovery'}
    {@const code = view.code}
    <RecoveryCodeScreen
      {code}
      {copied}
      bind:confirmed
      oncopy={() => copyCode(code)}
      ondownload={() => downloadCode(code)}
      oncontinue={saveTab}
    />
  {:else if view.name === 'unsupported'}
    <h1 class="visually-hidden">Guardar página</h1>
    <InlineNotice icon="link_off" title="Esta página no se puede guardar">
      Stash guarda páginas web (las que empiezan por http o https).
    </InlineNotice>
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
        <p class="state ok" role="status"><Icon name="check" size={20} />Guardado</p>
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
      <a class="open" href={appUrl} target="_blank" rel="noopener noreferrer">Abrir Stash</a>
      <Button variant="primary" onclick={onclose}>Listo</Button>
    </div>
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
    display: inline-flex;
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
