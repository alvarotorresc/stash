<script lang="ts">
  interface Props {
    size?: number;
  }

  let { size = 18 }: Props = $props();
</script>

<!-- Decorative: the text next to it says what is happening. -->
<span class="ring" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>

<style>
  .ring {
    display: inline-block;
    flex: none;
    border: 2px solid var(--line);
    border-top-color: var(--accent-text);
    border-radius: 50%;
    animation: spin 700ms linear infinite;
  }
  /* Constant motion is the only way a ring says "working"; reduced motion keeps it slow. */
  @media (prefers-reduced-motion: reduce) {
    .ring {
      animation-duration: 2s;
    }
  }
  @keyframes spin {
    to {
      transform: rotate(1turn);
    }
  }
</style>
