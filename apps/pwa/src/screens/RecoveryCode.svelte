<script lang="ts">
  import { RecoveryCodeScreen } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';

  const app = useApp();
  let copied = $state(false);
  let confirmed = $state(false);
  const code = $derived(app.recoveryCode ?? '');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      copied = true;
    } catch {
      copied = false;
    }
  }

  function download() {
    const text = `Código de recuperación de Stash\n\n${code}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'stash-codigo-de-recuperacion.txt';
    link.click();
    URL.revokeObjectURL(url);
  }

  function next() {
    app.recoveryCode = null;
    app.router.replace({ name: 'pending' });
  }
</script>

<main class="screen">
  <span class="word">Stash</span>
  <RecoveryCodeScreen
    {code}
    {copied}
    bind:confirmed
    oncopy={copy}
    ondownload={download}
    oncontinue={next}
  />
</main>

<style>
  .screen {
    flex: 1;
    min-height: 0;
    /* The recovery screen brings its own side gutter. */
    padding: calc(24px + env(safe-area-inset-top, 0px)) 0 32px;
    overflow-y: auto;
  }
  .word {
    display: block;
    margin: 0 24px 16px;
    font-size: var(--fs-word);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
</style>
