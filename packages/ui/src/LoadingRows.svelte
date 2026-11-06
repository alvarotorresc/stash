<script lang="ts">
  interface Props {
    groups?: number;
    rowsPerGroup?: number;
  }

  let { groups = 2, rowsPerGroup = 2 }: Props = $props();

  // Fixed, varied widths so the blocks read as rows; no shimmer (it speeds nothing up).
  const widths = [
    [92, 58],
    [84, 46],
    [88, 52],
    [76, 40],
  ];
  const width = (g: number, r: number) => widths[(g * rowsPerGroup + r) % widths.length]!;
</script>

<div class="loading" role="status">
  <span class="visually-hidden">Cargando</span>
  {#each { length: groups }, g (g)}
    <div class="grp" aria-hidden="true"><div class="skel" style:width="{60 + g * 10}px"></div></div>
    <div class="list" aria-hidden="true">
      {#each { length: rowsPerGroup }, r (r)}
        <div class="row">
          <div class="th"></div>
          <div class="lines">
            <div class="skel" style:width="{width(g, r)[0]}%"></div>
            <div class="skel" style:width="{width(g, r)[1]}%"></div>
          </div>
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .grp {
    padding: 14px 20px 6px;
  }
  .grp .skel {
    height: 14px;
  }
  .list {
    margin: 0 12px;
    padding: 0 14px;
    border-radius: var(--radius-block);
    background: var(--surface);
  }
  .row {
    display: flex;
    gap: 12px;
    padding: 12px 0;
  }
  .row + .row {
    border-top: 1px solid var(--line);
  }
  .th {
    width: 48px;
    height: 48px;
    flex: none;
    border-radius: var(--radius-control);
    background: var(--line);
  }
  .lines {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    padding-top: 4px;
  }
  .skel {
    height: 12px;
    border-radius: var(--radius-chip);
    background: var(--line);
  }
</style>
