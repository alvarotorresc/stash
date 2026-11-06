<script lang="ts">
  import { Button, Dialog, PasswordField, SettingsGroup, SettingsRow, SubpageBar } from '@stash/ui';
  import { useApp } from '../lib/app.svelte';
  import { shortDate } from '../lib/format';
  import { AccountError } from '../lib/service';
  import ChangePassword from './ChangePassword.svelte';

  const app = useApp();

  let deleting = $state(false);
  let password = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);
  let exportFailed = $state(false);
  let changingPassword = $state(false);
  let passwordChanged = $state(false);

  async function exportAll() {
    exportFailed = false;
    try {
      const blob = await app.service.exportAll();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'stash.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      exportFailed = true;
    }
  }

  function openDelete() {
    password = '';
    error = undefined;
    deleting = true;
  }

  async function confirmDelete(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    if (!password) {
      error = 'Escribe tu contraseña para confirmar.';
      return;
    }
    busy = true;
    try {
      await app.service.deleteAccount(password);
      deleting = false;
      app.router.replace({ name: 'register' });
    } catch (failure) {
      error =
        failure instanceof AccountError && failure.code === 'wrong-password'
          ? 'La contraseña no es correcta.'
          : 'No se ha podido borrar la cuenta. Comprueba la conexión.';
    } finally {
      busy = false;
    }
  }
</script>

<SubpageBar title="Ajustes" onback={() => app.router.back()} />
<main class="content">
  <SettingsGroup title="Cuenta">
    <SettingsRow
      icon="lock"
      label={app.session?.email ?? ''}
      description={app.session
        ? `Este dispositivo te recuerda hasta el ${shortDate(app.session.rememberedUntil)}`
        : undefined}
    />
    <SettingsRow
      icon="edit"
      label="Cambiar contraseña"
      description="Pide la actual. Tus datos siguen igual."
      onclick={() => {
        passwordChanged = false;
        changingPassword = true;
      }}
    />
  </SettingsGroup>
  {#if passwordChanged}
    <p class="done" role="status">
      Contraseña cambiada. Los demás dispositivos tendrán que entrar.
    </p>
  {/if}

  <SettingsGroup title="Organizar">
    <SettingsRow
      icon="label"
      label="Categorías"
      count={app.categories.length}
      chevron
      onclick={() => app.router.replace({ name: 'categories' })}
    />
    <SettingsRow
      icon="sell"
      label="Etiquetas"
      count={app.tags.length}
      chevron
      onclick={() => app.router.go({ name: 'tags' })}
    />
  </SettingsGroup>

  <SettingsGroup title="Tus datos">
    <SettingsRow
      icon="download"
      label="Exportar todo"
      description="Un archivo con tus guardados, categorías y etiquetas."
      onclick={exportAll}
    />
    <SettingsRow
      icon="logout"
      label="Cerrar sesión"
      description="Borra la copia local de este dispositivo."
      onclick={() => app.logout()}
    />
    <SettingsRow
      icon="delete"
      label="Borrar cuenta"
      description="Pide la contraseña. No se puede deshacer."
      onclick={openDelete}
    />
  </SettingsGroup>
  {#if exportFailed}
    <p class="error" role="alert">No se ha podido preparar el archivo. Vuelve a intentarlo.</p>
  {/if}

  <p class="foot">Stash · código abierto, AGPL-3.0</p>
</main>

<ChangePassword
  open={changingPassword}
  onclose={() => (changingPassword = false)}
  ondone={() => {
    changingPassword = false;
    passwordChanged = true;
  }}
/>

<Dialog open={deleting} title="Borrar la cuenta" onclose={() => (deleting = false)}>
  <form class="del" onsubmit={confirmDelete}>
    <p>
      Se borran tus guardados, categorías y etiquetas de este dispositivo y del servidor. No se
      puede deshacer.
    </p>
    <PasswordField
      label="Contraseña"
      autocomplete="current-password"
      bind:value={password}
      {error}
    />
    <div class="acts">
      <Button onclick={() => (deleting = false)}>Cancelar</Button>
      <Button type="submit" variant="danger" unavailable={busy}>Borrar cuenta</Button>
    </div>
  </form>
</Dialog>

<style>
  .content {
    flex: 1;
    min-height: 0;
    padding: 16px 0 24px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .foot,
  .done,
  .error {
    margin: 0 20px;
    color: var(--muted);
    font-size: var(--fs-meta);
  }
  .error,
  .done {
    margin-bottom: 16px;
  }
  .error {
    color: var(--danger);
  }
  .del {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .del p {
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
