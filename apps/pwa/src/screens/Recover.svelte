<script lang="ts">
  import { AccountForm, SubpageBar, TextField } from '@stash/ui';
  import { accountMessage } from '../lib/accountErrors';
  import { useApp } from '../lib/app.svelte';
  import AuthLayout from './AuthLayout.svelte';

  const app = useApp();
  let email = $state(app.service.lastEmail() ?? '');
  let code = $state('');
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  const strength = $derived(app.service.passwordStrength(password));

  async function submit() {
    if (!email.trim() || !code.trim()) {
      error = 'Escribe tu email y el código de recuperación.';
      return;
    }
    if (password.length < 10 || strength?.blocked) {
      error = 'Elige una contraseña de al menos 10 caracteres que no sea muy común.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      await app.service.recover(email, code, password);
    } catch (failure) {
      error = accountMessage(failure);
    } finally {
      busy = false;
    }
  }
</script>

<SubpageBar heading={false} onback={() => app.router.back({ name: 'login' })} />
<AuthLayout
  title="Recuperar con tu código"
  lead="Escribe el código que guardaste al crear la cuenta y elige una contraseña nueva. Tus datos siguen ahí."
>
  <AccountForm
    submitLabel="Cambiar contraseña"
    passwordMode="new"
    passwordLabel="Contraseña nueva"
    bind:email
    bind:password
    {strength}
    {error}
    {busy}
    onsubmit={submit}
  >
    <TextField
      label="Código de recuperación"
      mono
      autocomplete="off"
      autocapitalize="characters"
      autocorrect="off"
      spellcheck="false"
      bind:value={code}
    />
  </AccountForm>
</AuthLayout>
