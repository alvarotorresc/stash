<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import TextField from './TextField.svelte';
  import Icon from './icons/Icon.svelte';

  interface Props extends Omit<HTMLInputAttributes, 'value' | 'type' | 'autocomplete'> {
    label: string;
    value?: string;
    /** new-password when creating it, current-password when entering. */
    autocomplete: 'new-password' | 'current-password';
    help?: string;
    error?: string;
  }

  let { label, value = $bindable(''), autocomplete, help, error, ...rest }: Props = $props();
  let visible = $state(false);
</script>

<TextField
  {label}
  bind:value
  {help}
  {error}
  {autocomplete}
  type={visible ? 'text' : 'password'}
  autocapitalize="none"
  autocorrect="off"
  spellcheck="false"
  {...rest}
>
  {#snippet trailing()}
    <button
      type="button"
      class="eye"
      aria-label="Mostrar contraseña"
      aria-pressed={visible}
      onclick={() => (visible = !visible)}
    >
      <Icon name={visible ? 'visibility_off' : 'visibility'} />
    </button>
  {/snippet}
</TextField>

<style>
  .eye {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    margin-right: 2px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .eye:active {
    transform: scale(var(--press-scale));
  }
</style>
