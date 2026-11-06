<script lang="ts">
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';

  export type Tab = 'pending' | 'search' | 'categories';

  interface Props {
    active: Tab;
    onnavigate: (tab: Tab) => void;
  }

  let { active, onnavigate }: Props = $props();

  const tabs: { id: Tab; label: string; icon: IconName }[] = [
    { id: 'pending', label: 'Pendientes', icon: 'inbox' },
    { id: 'search', label: 'Buscar', icon: 'search' },
    { id: 'categories', label: 'Categorías', icon: 'label' },
  ];
</script>

<nav class="tabs" aria-label="Secciones">
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      class:on={active === tab.id}
      aria-current={active === tab.id ? 'page' : undefined}
      onclick={() => onnavigate(tab.id)}
    >
      <Icon name={tab.icon} filled={active === tab.id} />
      {tab.label}
    </button>
  {/each}
</nav>

<style>
  .tabs {
    display: flex;
    padding: 4px 8px max(18px, env(safe-area-inset-bottom, 0px));
    border-top: 1px solid var(--line);
    background: var(--surface);
  }
  button {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    min-height: 52px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--muted);
    font-size: var(--fs-tab);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .on {
    color: var(--accent-text);
    font-weight: 700;
  }
</style>
