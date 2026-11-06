<script lang="ts">
  import Icon from './icons/Icon.svelte';
  import type { IconName } from './icons/icons';
  import type { Tone } from './types';

  interface Props {
    /** Saved image (already decrypted, for example a blob URL). */
    src?: string;
    /** Placeholder tone when there is no image. */
    tone?: Tone;
    /** Placeholder icon when there is no image. */
    icon?: IconName;
    size?: 48 | 56;
  }

  let { src, tone = 1, icon = 'image', size = 48 }: Props = $props();
</script>

<span class="th" style:--size="{size}px" style:background={src ? undefined : `var(--t${tone})`}>
  {#if src}
    <img {src} alt="" width={size} height={size} />
  {:else}
    <span class="ph"><Icon name={icon} /></span>
  {/if}
</span>

<style>
  .th {
    display: grid;
    place-items: center;
    width: var(--size);
    height: var(--size);
    flex: none;
    overflow: hidden;
    border-radius: var(--radius-control);
    color: var(--ink);
  }
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ph {
    opacity: 0.7;
  }
</style>
