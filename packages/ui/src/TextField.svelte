<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLInputAttributes } from 'svelte/elements';

  interface Props extends Omit<HTMLInputAttributes, 'value'> {
    /** Visible label above the field. Never a placeholder alone. */
    label: string;
    value?: string;
    /** Help line under the field. */
    help?: string;
    /** Error line under the field; marks the field invalid. */
    error?: string;
    /** Monospace with spacing: recovery codes (tells 0 from O and 1 from I). */
    mono?: boolean;
    /** Content inside the field box after the input (for example, a button). */
    trailing?: Snippet;
  }

  let {
    label,
    value = $bindable(''),
    help,
    error,
    mono = false,
    trailing,
    id,
    type = 'text',
    ...rest
  }: Props = $props();

  const uid = $props.id();
  const inputId = $derived(id ?? `field-${uid}`);
  const noteId = $derived(`${inputId}-note`);
  const note = $derived(error ?? help);
</script>

<div class="wrap">
  <label class="label" for={inputId}>{label}</label>
  <div class="field" class:invalid={!!error}>
    <input
      id={inputId}
      {type}
      class:mono
      bind:value
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={note ? noteId : undefined}
      {...rest}
    />
    {@render trailing?.()}
  </div>
  {#if note}
    <p id={noteId} class="note" class:error={!!error}>{note}</p>
  {/if}
</div>

<style>
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: var(--fs-label);
    font-weight: 600;
  }
  .field {
    display: flex;
    align-items: center;
    min-height: 48px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
  }
  .field:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .field.invalid {
    border-color: var(--danger);
  }
  input {
    flex: 1;
    min-width: 0;
    min-height: 46px;
    padding: 0 12px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--ink);
    font-size: var(--fs-input);
  }
  /* The field box shows focus (border + ring); the input itself does not. */
  input:focus-visible {
    outline: none;
  }
  input::placeholder {
    color: var(--muted);
  }
  .mono {
    font-family: var(--font-mono);
    letter-spacing: 0.04em;
  }
  .note {
    margin: 0;
    font-size: var(--fs-help);
    line-height: 1.4;
    color: var(--muted);
  }
  .note.error {
    color: var(--danger);
  }
</style>
