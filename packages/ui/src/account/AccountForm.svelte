<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '../Button.svelte';
  import PasswordField from '../PasswordField.svelte';
  import TextField from '../TextField.svelte';
  import PasswordMeter, { type PasswordStrength } from './PasswordMeter.svelte';

  interface Props {
    /** Crear cuenta, Entrar or Cambiar contraseña. */
    submitLabel: string;
    email?: string;
    password?: string;
    /** new: creating a password (shows the meter). current: entering. */
    passwordMode: 'new' | 'current';
    passwordLabel?: string;
    /** Strength of the new password, computed by the caller. */
    strength?: PasswordStrength | null;
    /** Why the last attempt failed, said in plain words. */
    error?: string;
    /** Waiting for the answer: the button ignores presses. */
    busy?: boolean;
    onsubmit: () => void;
    /** Extra fields between the email and the password (the recovery code). */
    children?: Snippet;
  }

  let {
    submitLabel,
    email = $bindable(''),
    password = $bindable(''),
    passwordMode,
    passwordLabel = 'Contraseña',
    strength = null,
    error,
    busy = false,
    onsubmit,
    children,
  }: Props = $props();

  const uid = $props.id();
  const meterId = `meter-${uid}`;
  const errorId = `error-${uid}`;

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!busy) onsubmit();
  }
</script>

<form class="form" novalidate onsubmit={submit} aria-describedby={error ? errorId : undefined}>
  <TextField
    label="Email"
    type="email"
    autocomplete="username"
    autocapitalize="none"
    spellcheck="false"
    inputmode="email"
    required
    bind:value={email}
  />
  {@render children?.()}
  {#if passwordMode === 'new'}
    <div class="pw">
      <PasswordField
        label={passwordLabel}
        autocomplete="new-password"
        required
        minlength={10}
        aria-describedby={meterId}
        bind:value={password}
      />
      <PasswordMeter id={meterId} {strength} />
    </div>
  {:else}
    <PasswordField
      label={passwordLabel}
      autocomplete="current-password"
      required
      bind:value={password}
    />
  {/if}
  {#if error}
    <p class="error" id={errorId} role="alert">{error}</p>
  {/if}
  <Button type="submit" variant="primary" block unavailable={busy}>
    {busy ? `${submitLabel}…` : submitLabel}
  </Button>
</form>

<style>
  .form {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .pw {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .error {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-help);
  }
</style>
