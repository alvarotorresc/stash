<script lang="ts">
  interface Props {
    title: string;
    /** One sentence that says how the list fills up. */
    text: string;
  }

  let { title, text }: Props = $props();
</script>

<div class="empty">
  <h2>{title}</h2>
  <p>{text}</p>
</div>

<style>
  .empty {
    padding: 40px 20px 0;
  }
  h2 {
    margin: 0 0 6px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  p {
    max-width: 30ch;
    margin: 0;
    color: var(--muted);
    font-size: var(--fs-title);
  }
</style>
