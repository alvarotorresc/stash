<script lang="ts">
  import { AccountForm } from '@stash/ui';
  import { accountMessage } from '../lib/accountErrors';
  import { useApp } from '../lib/app.svelte';
  import AuthLayout from './AuthLayout.svelte';

  const app = useApp();
  let email = $state('');
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const strength = $derived(app.service.passwordStrength(password));

  async function submit() {
    if (!email.includes('@')) {
      error = 'Escribe un email válido.';
      return;
    }
    if (password.length < 10 || strength?.blocked) {
      error = 'Elige una contraseña de al menos 10 caracteres que no sea muy común.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      const { recoveryCode } = await app.service.register(email, password);
      app.recoveryCode = recoveryCode;
    } catch (failure) {
      error = accountMessage(failure);
    } finally {
      busy = false;
    }
  }
</script>

<AuthLayout
  title="Crea tu cuenta"
  lead="Tu contraseña también cifra lo que guardas. El servidor solo guarda datos cifrados y no puede leerlos."
>
  <AccountForm
    submitLabel="Crear cuenta"
    passwordMode="new"
    bind:email
    bind:password
    {strength}
    {error}
    {busy}
    onsubmit={submit}
  />
  {#snippet footer()}
    <span>¿Ya tienes cuenta? <a href="#/entrar">Entrar</a></span>
  {/snippet}
</AuthLayout>
