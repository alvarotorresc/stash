<script lang="ts">
  import { AccountForm } from '@stash/ui';
  import { accountMessage } from '../lib/accountErrors';
  import { useApp } from '../lib/app.svelte';
  import AuthLayout from './AuthLayout.svelte';

  const app = useApp();
  // Unlocking after the 30 days: the email is already there.
  let email = $state(app.service.lastEmail() ?? '');
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  async function submit() {
    if (!email.trim() || !password) {
      error = 'Escribe tu email y tu contraseña.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      await app.service.login(email, password);
    } catch (failure) {
      error = accountMessage(failure);
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout title="Entrar" lead="Este dispositivo te recordará 30 días o hasta que cierres sesión.">
  <AccountForm
    submitLabel="Entrar"
    passwordMode="current"
    bind:email
    bind:password
    {error}
    {busy}
    onsubmit={submit}
  />
  {#snippet footer()}
    <a href="#/recuperar">He olvidado la contraseña</a>
    <span>¿No tienes cuenta? <a href="#/crear-cuenta">Crear cuenta</a></span>
  {/snippet}
</AuthLayout>
