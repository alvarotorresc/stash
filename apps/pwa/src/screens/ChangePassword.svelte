<script lang="ts">
  import { Button, Dialog, PasswordField, PasswordMeter } from '@stash/ui';
  import { accountMessage } from '../lib/accountErrors';
  import { useApp } from '../lib/app.svelte';

  interface Props {
    open: boolean;
    onclose: () => void;
    /** The password changed: the settings say so. */
    ondone: () => void;
  }

  let { open, onclose, ondone }: Props = $props();
  const app = useApp();

  let current = $state('');
  let next = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const strength = $derived(app.service.passwordStrength(next));

  // Every time the dialog opens it starts empty: no password stays in the form.
  $effect(() => {
    if (open) {
      current = '';
      next = '';
      error = undefined;
    }
  });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!current || !next) {
      error = 'Escribe la contraseña actual y la nueva.';
      return;
    }
    if (next.length < 10 || strength?.blocked) {
      error = 'Elige una contraseña de al menos 10 caracteres que no sea muy común.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      await app.service.changePassword(current, next);
      current = '';
      next = '';
      ondone();
    } catch (failure) {
      error = accountMessage(failure);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog {open} title="Cambiar contraseña" {onclose}>
  <form class="form" onsubmit={submit}>
    <p>Tus datos no se vuelven a cifrar. Los demás dispositivos tendrán que volver a entrar.</p>
    <PasswordField label="Contraseña actual" autocomplete="current-password" bind:value={current} />
    <div>
      <PasswordField
        label="Contraseña nueva"
        autocomplete="new-password"
        bind:value={next}
        {error}
      />
      <PasswordMeter {strength} />
    </div>
    <div class="acts">
      <Button onclick={onclose}>Cancelar</Button>
      <Button type="submit" variant="primary" unavailable={busy}>Cambiar</Button>
    </div>
  </form>
</Dialog>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .form p {
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-help);
  }
  .acts {
    display: flex;
    gap: 10px;
  }
  .acts > :global(.btn) {
    flex: 1;
  }
</style>
