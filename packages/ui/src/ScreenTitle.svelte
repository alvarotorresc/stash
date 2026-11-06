<script lang="ts">
  interface Props {
    title: string;
    /** One line under the title, for example "6 por leer". */
    subtitle?: string;
  }

  let { title, subtitle }: Props = $props();
</script>

<div class="ttl">
  <h1>{title}</h1>
  {#if subtitle}<p>{subtitle}</p>{/if}
</div>

<style>
  .ttl {
    padding: 8px 20px 14px;
  }
  h1 {
    margin: 0;
    font-size: var(--fs-display);
    line-height: 1.15;
    letter-spacing: -0.025em;
    font-weight: 700;
  }
  p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 15px;
  }
</style>
