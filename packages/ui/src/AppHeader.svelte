<script lang="ts">
  import IconButton from './IconButton.svelte';

  interface Props {
    /** Opens Settings (used rarely, so it lives here and not in a tab). */
    onsettings: () => void;
  }

  let { onsettings }: Props = $props();
</script>

<header class="hd">
  <span class="word">Stash</span>
  <IconButton icon="settings" label="Ajustes" onclick={onsettings} />
</header>

<style>
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(4px + env(safe-area-inset-top, 0px)) 8px 0 20px;
  }
  .word {
    font-size: var(--fs-word);
    font-weight: 700;
    letter-spacing: -0.02em;
  }
</style>
