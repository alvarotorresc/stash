<script lang="ts">
  import { icons, type IconName } from './icons';

  interface Props {
    name: IconName;
    /** Filled variant: marks the active tab. */
    filled?: boolean;
    size?: number;
    /** Accessible name. Without it the icon is decorative and hidden. */
    label?: string;
  }

  let { name, filled = false, size = 22, label }: Props = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 -960 960 960"
  fill="currentColor"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  focusable="false"
>
  <path d={filled ? icons[name].fill : icons[name].outline} />
</svg>

<style>
  .icon {
    display: block;
    flex: none;
  }
</style>
