<script lang="ts">
  import Icon from './icons/Icon.svelte';

  interface Props {
    label: string;
    checked?: boolean;
    onchange?: (checked: boolean) => void;
  }

  let { label, checked = $bindable(false), onchange }: Props = $props();
</script>

<label class="check">
  <input
    type="checkbox"
    bind:checked
    onchange={(event) => onchange?.(event.currentTarget.checked)}
  />
  <span class="box" aria-hidden="true"><Icon name="check" size={18} /></span>
  <span>{label}</span>
</label>

<style>
  .check {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 48px;
    font-size: var(--fs-title);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
  }
  input {
    position: absolute;
    inset: 0;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }
  .box {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex: none;
    border: 2px solid var(--line-strong);
    border-radius: var(--radius-chip);
    color: transparent;
  }
  input:checked + .box {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  input:focus-visible + .box {
    outline: 2px solid var(--accent-text);
    outline-offset: 2px;
  }
</style>
