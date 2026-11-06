<script lang="ts">
  import Button from '../Button.svelte';
  import Checkbox from '../Checkbox.svelte';

  const GROUP = 4;

  interface Props {
    /** 28 characters; spaces are ignored. Shown in 7 groups of 4. */
    code: string;
    oncopy: () => void;
    ondownload: () => void;
    /** Only after the box is checked. */
    oncontinue: () => void;
    /** Shows "Copiado" on the copy button. */
    copied?: boolean;
    confirmed?: boolean;
  }

  let {
    code,
    oncopy,
    ondownload,
    oncontinue,
    copied = false,
    confirmed = $bindable(false),
  }: Props = $props();

  const uid = $props.id();
  const groups = $derived(
    code
      .replace(/\s+/g, '')
      .toUpperCase()
      .match(new RegExp(`.{1,${GROUP}}`, 'g')) ?? [],
  );
  // Spelled out so screen readers read characters, not words.
  const spelled = $derived(groups.map((group) => group.split('').join(' ')).join(', '));
</script>

<section class="auth" aria-labelledby="recovery-{uid}">
  <h1 id="recovery-{uid}">Tu código de recuperación</h1>
  <p class="lead">
    Si olvidas la contraseña, este código es la única forma de volver a entrar. Se muestra solo
    ahora.
  </p>
  <div class="code">
    <span class="visually-hidden">{spelled}</span>
    <span class="groups" aria-hidden="true">
      {#each groups as group, index (index)}<span class="g">{group}</span>{/each}
    </span>
  </div>
  <div class="acts">
    <Button icon={copied ? 'check' : 'content_copy'} onclick={oncopy}>
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
    <Button icon="download" onclick={ondownload}>Descargar</Button>
  </div>
  <div class="check">
    <Checkbox label="Lo he guardado fuera de este móvil" bind:checked={confirmed} />
  </div>
  <Button
    variant="primary"
    block
    unavailable={!confirmed}
    onclick={() => {
      if (confirmed) oncontinue();
    }}>Continuar</Button
  >
</section>

<style>
  .auth {
    display: flex;
    flex-direction: column;
    padding: 12px 24px 24px;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-display);
    line-height: 1.15;
    letter-spacing: -0.025em;
    font-weight: 700;
  }
  .lead {
    margin: 8px 0 0;
    color: var(--muted);
    font-size: var(--fs-title);
  }
  .code {
    margin-top: 22px;
    padding: 18px 16px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-block);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: 21px;
    font-weight: 600;
    line-height: 1.7;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .groups {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    column-gap: 0.6em;
  }
  .g {
    user-select: all;
  }
  .acts {
    display: flex;
    gap: 10px;
    margin-top: 12px;
  }
  .acts :global(.btn) {
    flex: 1;
  }
  .check {
    margin: 18px 0 14px;
  }
</style>
