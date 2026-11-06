<script lang="ts">
  import {
    AppHeader,
    ArticleContent,
    BottomBar,
    Button,
    CategoryList,
    CategoryPicker,
    Checkbox,
    EmptyState,
    GroupHeader,
    InlineNotice,
    ItemList,
    ItemRow,
    LoadingRows,
    PasswordField,
    PasswordMeter,
    PreviewContent,
    PrioritySegment,
    ReadingView,
    RecoveryCodeScreen,
    RedditContent,
    SaveSheet,
    ScreenTitle,
    SubpageBar,
    TagInput,
    TextField,
    TweetContent,
    UndoToast,
    UnsortedStrip,
    type ListEntry,
    type PasswordStrength,
    type Priority,
    type SanitizedHtml,
    type Tab,
    type UndoToastData,
  } from '../src/index';

  // Review page only. Every text and number here is sample content.
  type Theme = 'system' | 'light' | 'dark';
  const themes: { id: Theme; label: string }[] = [
    { id: 'system', label: 'Sistema' },
    { id: 'light', label: 'Claro' },
    { id: 'dark', label: 'Oscuro' },
  ];
  const initial = new URLSearchParams(location.search).get('theme');
  let theme = $state<Theme>(initial === 'light' || initial === 'dark' ? initial : 'system');

  $effect(() => {
    if (theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
  });

  const html = (value: string) => value as SanitizedHtml;
  const noop = () => {};

  let online = $state(true);
  let tab = $state<Tab>('pending');

  // Classification state, as the app would keep it.
  let categories = $state([
    { id: 'c1', name: 'Recetas' },
    { id: 'c2', name: 'Casa' },
    { id: 'c3', name: 'Trabajo' },
  ]);
  let priority = $state<Priority | null>('medium');
  let category = $state<string | null>('c1');
  let tags = $state<string[]>(['otoño']);
  let tagQuery = $state('');
  const usedTags = [
    { name: 'cena', count: 6 },
    { name: 'cenas rápidas', count: 2 },
    { name: 'despensa', count: 1 },
    { name: 'atajos', count: 3 },
    { name: 'bici', count: 2 },
  ];
  const tagSuggestions = $derived(
    usedTags.filter(
      (tag) => tag.name.startsWith(tagQuery.trim().toLowerCase()) && !tags.includes(tag.name),
    ),
  );

  function createCategory(name: string) {
    const id = `c${categories.length + 1}`;
    categories = [...categories, { id, name }];
    category = id;
  }

  let sheet = $state<'saved' | 'queued' | 'classify' | null>(null);

  // Category management.
  let entries = $state<ListEntry[]>([
    { id: 'c3', name: 'Trabajo', count: 12 },
    { id: 'c2', name: 'Casa', count: 7 },
    { id: 'c1', name: 'Recetas', count: 9 },
    { id: 'c4', name: 'Madrid', count: 5 },
  ]);
  let tagEntries = $state<ListEntry[]>([
    { id: 't1', name: 'atajos', count: 3 },
    { id: 't2', name: 'bici', count: 2 },
    { id: 't3', name: 'cena', count: 6 },
  ]);

  // Undo toast.
  let toast = $state<UndoToastData | null>(null);
  let toastSeq = 0;
  const showToast = (message: string) => (toast = { id: ++toastSeq, message });

  // Password: a stand-in for the real strength check, which lives outside the kit.
  let password = $state('');
  const strength = $derived<PasswordStrength | null>(
    password === ''
      ? null
      : ['contraseña', '1234567890', 'qwertyuiop'].includes(password.toLowerCase())
        ? { level: 1, blocked: true, message: 'Es muy común. Elige otra.' }
        : password.length < 10
          ? { level: 1, blocked: false, message: 'Mínimo 10 caracteres.' }
          : {
              level: password.length >= 16 ? 4 : 3,
              blocked: false,
              message: 'Vale.',
            },
  );

  let copied = $state(false);
</script>

<header class="top">
  <h1>Stash UI kit</h1>
  <div class="theme" role="group" aria-label="Tema">
    {#each themes as option (option.id)}
      <button type="button" aria-pressed={theme === option.id} onclick={() => (theme = option.id)}>
        {option.label}
      </button>
    {/each}
  </div>
  <p class="intro">Catálogo para revisar los componentes. Los textos y números son de ejemplo.</p>
</header>

<main>
  <section aria-labelledby="s-home">
    <h2 class="sec" id="s-home">Inicio</h2>
    <div class="toggle">
      <Checkbox label="Sin conexión" bind:checked={() => !online, (v) => (online = !v)} />
    </div>
    <div class="frame">
      <AppHeader onsettings={noop} />
      <ScreenTitle title="Pendientes" subtitle={online ? '6 por leer' : '7 por leer'} />
      {#if !online}
        <div class="pad">
          <InlineNotice icon="cloud_off" title="Sin conexión">
            Puedes leer lo ya descargado. Para clasificar o marcar hace falta red.
          </InlineNotice>
        </div>
      {/if}
      <UnsortedStrip count={online ? 1 : 2} {online} onclassify={() => (sheet = 'classify')}>
        {#if !online}
          <ItemRow
            title="reddit.com/r/Madrid/comments/1h2k…"
            origin="Reddit"
            queued
            thumbnail={{ tone: 3 }}
            onopen={noop}
          />
        {/if}
        <ItemRow
          title="Vía Verde del Aceite: tramo de Jaén a Alcaudete en bici"
          origin="Web, rutasenbici.net"
          thumbnail={{ tone: 4 }}
          onopen={noop}
        />
      </UnsortedStrip>
      <GroupHeader name="Alta" count={2} />
      <ItemList label="Alta">
        <ItemRow
          title="Cómo organizar la despensa para no tirar comida"
          origin="Web, lacocinaordenada.es"
          category="Casa"
          thumbnail={{ tone: 2 }}
          onopen={noop}
        />
        <ItemRow
          title="¿Compensa el abono transporte anual si teletrabajo dos días?"
          origin="Reddit, r/askspain"
          category="Madrid"
          thumbnail={{ tone: 3 }}
          onopen={noop}
        />
      </ItemList>
      <GroupHeader name="Media" count={1} />
      <ItemList label="Media">
        <ItemRow
          title="Los atajos de VS Code que más uso al revisar código"
          origin="X, @martagil_dev"
          category="Trabajo"
          thumbnail={{ tone: 1 }}
          onopen={noop}
        />
      </ItemList>
      <div class="spacer"></div>
      <BottomBar active={tab} onnavigate={(next) => (tab = next)} />
    </div>
  </section>

  <section aria-labelledby="s-states">
    <h2 class="sec" id="s-states">Estados</h2>
    <div class="frame">
      <EmptyState
        title="Lo tienes todo leído"
        text="Comparte un enlace a Stash desde cualquier app del móvil, o guarda una página con la extensión del navegador."
      />
      <div class="spacer"></div>
    </div>
    <div class="frame">
      <LoadingRows />
      <div class="spacer"></div>
    </div>
    <div class="stack">
      <InlineNotice icon="cloud_off" title="Sin conexión">
        Puedes leer lo ya descargado. Para clasificar o marcar hace falta red.
      </InlineNotice>
      <InlineNotice icon="link_off" title="X no ha dejado leer este post">
        Tienes la vista previa y el enlace. Lo guardado no se pierde.
      </InlineNotice>
    </div>
  </section>

  <section aria-labelledby="s-save">
    <h2 class="sec" id="s-save">Guardar y clasificar</h2>
    <div class="row">
      <Button variant="primary" onclick={() => (sheet = 'saved')}>Hoja tras compartir</Button>
      <Button onclick={() => (sheet = 'queued')}>Hoja sin conexión</Button>
    </div>
    <div class="stack surface">
      <PrioritySegment value={priority} onchange={(value) => (priority = value)} />
      <CategoryPicker
        {categories}
        selected={category}
        onselect={(id) => (category = id)}
        oncreate={createCategory}
      />
      <TagInput
        {tags}
        suggestions={tagSuggestions}
        bind:query={tagQuery}
        onadd={(name) => (tags = [...tags, name])}
        onremove={(name) => (tags = tags.filter((tag) => tag !== name))}
      />
    </div>
  </section>

  <section aria-labelledby="s-controls">
    <h2 class="sec" id="s-controls">Botones y campos</h2>
    <div class="stack">
      <div class="row">
        <Button>Descartar</Button>
        <Button variant="primary">Marcar leído</Button>
      </div>
      <div class="row">
        <Button variant="danger">Borrar</Button>
        <Button unavailable>No disponible</Button>
      </div>
      <TextField label="Email" type="email" autocomplete="username" value="maria@ejemplo.com" />
      <PasswordField
        label="Contraseña"
        autocomplete="new-password"
        bind:value={password}
        aria-describedby="pw-meter"
      />
      <PasswordMeter {strength} id="pw-meter" />
      <TextField
        label="Código de recuperación"
        mono
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        value="K7QF 2M9X WD4R 8H"
      />
      <TextField
        label="Buscar"
        type="search"
        enterkeyhint="search"
        error="Escribe algo para buscar"
      />
    </div>
  </section>

  <section aria-labelledby="s-lists">
    <h2 class="sec" id="s-lists">Categorías y etiquetas</h2>
    <p class="cap">Arrastra por el asa, o enfócala y usa las flechas. Las de arriba salen antes.</p>
    <CategoryList
      items={entries}
      label="Categorías"
      onreorder={(ids) => (entries = ids.map((id) => entries.find((entry) => entry.id === id)!))}
      onrename={(id, name) =>
        (entries = entries.map((entry) => (entry.id === id ? { ...entry, name } : entry)))}
      ondelete={(id) => (entries = entries.filter((entry) => entry.id !== id))}
      deleteMessage={(item) =>
        `Sus ${item.count} guardados pasan a Sin clasificar. No se pierde nada.`}
    />
    <p class="cap">Etiquetas: se crean al guardar; aquí solo se renombran o se borran.</p>
    <CategoryList
      items={tagEntries}
      label="Etiquetas"
      reorderable={false}
      onrename={(id, name) =>
        (tagEntries = tagEntries.map((entry) => (entry.id === id ? { ...entry, name } : entry)))}
      ondelete={(id) => (tagEntries = tagEntries.filter((entry) => entry.id !== id))}
      deleteMessage={(item) => `Se quita de ${item.count} guardados. Los guardados no se borran.`}
    />
  </section>

  <section aria-labelledby="s-read">
    <h2 class="sec" id="s-read">Lectura</h2>
    <div class="frame read">
      <ReadingView
        link={{ label: 'Abrir original', href: 'https://example.com/' }}
        category="Casa"
        priority="high"
        tags={['despensa']}
        onback={noop}
        onclassify={() => (sheet = 'classify')}
        ondiscard={() => showToast('Descartado')}
        onmarkread={() => showToast('Marcado como leído')}
      >
        <ArticleContent
          source="lacocinaordenada.es · 6 min"
          title="Cómo organizar la despensa para no tirar comida"
          html={html(
            '<p>Lo primero es sacar todo y mirar fechas. Lo que caduca antes va delante y a la altura de los ojos; lo que dura meses, arriba o al fondo.</p><p>Después, agrupa por uso y no por tipo: lo del desayuno junto, lo de cenar rápido junto.</p>',
          )}
        />
      </ReadingView>
    </div>
    <div class="frame read">
      <ReadingView
        barTitle="X"
        link={{ label: 'Abrir en X', href: 'https://x.com/' }}
        category="Trabajo"
        priority="medium"
        tags={['atajos']}
        onback={noop}
        onclassify={noop}
        ondiscard={noop}
        onmarkread={noop}
      >
        <TweetContent
          author={{ name: 'Marta Gil', handle: '@martagil_dev' }}
          html={html(
            'Los atajos de VS Code que más uso al revisar código: Alt+clic para varios cursores, Ctrl+P para saltar a un archivo y F8 para ir al siguiente error.',
          )}
          date="14 oct. 2026, 18:02"
        />
      </ReadingView>
    </div>
    <div class="frame read">
      <ReadingView
        barTitle="Reddit"
        link={{ label: 'Abrir en Reddit', href: 'https://reddit.com/' }}
        onback={noop}
        onclassify={noop}
        ondiscard={noop}
        onmarkread={noop}
      >
        <RedditContent
          source="r/askspain · u/carmen_rv"
          title="¿Compensa el abono transporte anual si teletrabajo dos días?"
          html={html(
            '<p>Voy a la oficina tres días por semana y en agosto casi nada.</p><p>¿Alguien ha hecho la cuenta?</p>',
          )}
        />
      </ReadingView>
    </div>
    <div class="frame read">
      <ReadingView
        barTitle="Instagram"
        category="Recetas"
        tags={['otoño', 'cena']}
        onback={noop}
        onclassify={noop}
        ondiscard={noop}
        onmarkread={noop}
      >
        <PreviewContent
          title="@verduradetemporada en Instagram"
          description="Crema de calabaza asada con comino y yogur. Receta para cuatro…"
          open={{ label: 'Abrir en Instagram', href: 'https://instagram.com/' }}
          note="De Instagram, Stash guarda la vista previa y el enlace."
        />
      </ReadingView>
    </div>
    <div class="frame read">
      <ReadingView
        barTitle="X"
        link={{ label: 'Abrir en X', href: 'https://x.com/' }}
        category="Trabajo"
        priority="low"
        onback={noop}
        onclassify={noop}
        ondiscard={noop}
        onmarkread={noop}
      >
        <PreviewContent
          title="Marta Gil en X"
          description="«Hilo con las extensiones que tengo instaladas y por qué quité la mitad…»"
          open={{ label: 'Abrir en X', href: 'https://x.com/' }}
          blocked={{
            title: 'X no ha dejado leer este post',
            text: 'Tienes la vista previa y el enlace. Lo guardado no se pierde.',
          }}
        />
      </ReadingView>
    </div>
    <div class="frame read">
      <ReadingView
        link={{ label: 'Abrir original', href: 'https://example.com/' }}
        online={false}
        onback={noop}
        onclassify={noop}
        ondiscard={noop}
        onmarkread={noop}
      >
        <ArticleContent
          source="lacocinaordenada.es · 6 min"
          title="Cómo organizar la despensa para no tirar comida"
          html={html('<p>Una vez al mes, revisa lo de atrás.</p>')}
        />
      </ReadingView>
    </div>
  </section>

  <section aria-labelledby="s-account">
    <h2 class="sec" id="s-account">Cuenta</h2>
    <div class="frame">
      <RecoveryCodeScreen
        code="K7QF2M9XWD4R8HTNC3PV6YJBQ2ZE"
        {copied}
        oncopy={() => (copied = true)}
        ondownload={noop}
        oncontinue={() => showToast('Continuar pulsado')}
      />
    </div>
  </section>

  <section aria-labelledby="s-nav">
    <h2 class="sec" id="s-nav">Navegación</h2>
    <div class="frame">
      <SubpageBar title="Etiquetas" onback={noop} />
      <div class="spacer"></div>
      <BottomBar active={tab} onnavigate={(next) => (tab = next)} />
    </div>
    <div class="row">
      <Button onclick={() => showToast('Marcado como leído')}>Aviso de deshacer</Button>
    </div>
  </section>
</main>

<SaveSheet
  open={sheet !== null}
  variant={sheet ?? 'saved'}
  title={sheet === 'queued'
    ? 'reddit.com/r/Madrid/comments/1h2k…'
    : 'Crema de calabaza asada con comino y yogur'}
  thumbnail={{ tone: 4 }}
  {priority}
  {categories}
  {category}
  {tags}
  {tagSuggestions}
  bind:tagQuery
  onpriority={(value) => (priority = value)}
  oncategory={(id) => (category = id)}
  oncreatecategory={createCategory}
  ontagadd={(name) => (tags = [...tags, name])}
  ontagremove={(name) => (tags = tags.filter((tag) => tag !== name))}
  ondone={() => (sheet = null)}
  onclose={() => (sheet = null)}
/>

<UndoToast
  {toast}
  onundo={() => (toast = null)}
  onexpire={(id) => {
    if (toast?.id === id) toast = null;
  }}
/>

<style>
  .top {
    padding: calc(16px + env(safe-area-inset-top, 0px)) 16px 8px;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-display);
    letter-spacing: -0.025em;
  }
  .intro {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .theme {
    display: inline-grid;
    grid-template-columns: repeat(3, auto);
    margin-top: 12px;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
  }
  .theme button {
    min-height: 44px;
    padding: 0 14px;
    border: 0;
    border-left: 1px solid var(--line-strong);
    background: transparent;
    color: var(--ink);
    cursor: pointer;
  }
  .theme button:first-child {
    border-left: 0;
  }
  .theme button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 700;
  }
  main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 480px;
    padding-bottom: 140px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .sec {
    margin: 24px 16px 0;
    padding-top: 16px;
    border-top: 1px solid var(--line);
    font-size: 20px;
  }
  .toggle,
  .row,
  .stack,
  .pad {
    padding: 0 16px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .row :global(.btn) {
    flex: 1;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .pad {
    padding-bottom: 10px;
  }
  .surface {
    margin: 0 12px;
    padding: 16px 14px;
    border-radius: var(--radius-block);
    background: var(--surface);
  }
  .cap {
    margin: 0;
    padding: 0 20px;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .frame {
    display: flex;
    flex-direction: column;
    margin: 0 8px;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--bg);
  }
  .frame.read {
    height: 640px;
  }
  .spacer {
    flex: 1;
    min-height: 16px;
  }
</style>
