<script lang="ts">
  interface Props {
    /** Group name: Alta, Media or Baja. */
    name: string;
    count: number;
    /** Heading level inside the screen. */
    level?: 2 | 3;
  }

  let { name, count, level = 2 }: Props = $props();
</script>

<svelte:element this={`h${level}`} class="grp">
  {name} <span class="n">{count}</span>
</svelte:element>

<style>
  .grp {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0;
    padding: 14px 20px 6px;
    font-size: var(--fs-group);
    font-weight: 700;
  }
  .n {
    color: var(--muted);
    font-size: 14px;
    font-weight: 400;
  }
</style>
