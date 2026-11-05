<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  interface Props extends HTMLButtonAttributes {
    children: Snippet;
  }

  let { children, type = 'button', ...rest }: Props = $props();
</script>

<button {type} {...rest}>
  {@render children()}
</button>
