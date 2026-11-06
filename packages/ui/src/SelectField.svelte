<script lang="ts">
  import Icon from './icons/Icon.svelte';

  interface Props {
    /** Visible label above the field. */
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onchange: (value: string) => void;
  }

  let { label, value, options, onchange }: Props = $props();
  const uid = $props.id();
</script>

<div class="wrap">
  <label class="label" for="select-{uid}">{label}</label>
  <div class="field">
    <select id="select-{uid}" {value} onchange={(event) => onchange(event.currentTarget.value)}>
      {#each options as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    <span class="ic"><Icon name="keyboard_arrow_down" /></span>
  </div>
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
    position: relative;
    display: flex;
    align-items: center;
  }
  select {
    width: 100%;
    min-height: 48px;
    padding: 0 40px 0 12px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-control);
    background: var(--surface);
    color: var(--ink);
    font-size: var(--fs-input);
    appearance: none;
    cursor: pointer;
  }
  select:focus-visible {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent);
  }
  .ic {
    position: absolute;
    right: 10px;
    display: flex;
    color: var(--muted);
    pointer-events: none;
  }
</style>
