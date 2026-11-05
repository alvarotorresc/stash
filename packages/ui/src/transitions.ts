import { quintOut } from 'svelte/easing';
import { prefersReducedMotion } from 'svelte/motion';
import type { TransitionConfig } from 'svelte/transition';

const FADE = 160;
const COLLAPSE = 200;
const REDUCED_FADE = 150;

/**
 * A row leaving the list (read, discarded): fades out in 160 ms, then closes
 * the gap in 200 ms so the list does not jump. With reduced motion, only a
 * 150 ms fade. Use as `out:rowExit` on the element that leaves.
 */
export function rowExit(
  node: HTMLElement,
  { reduced = prefersReducedMotion.current }: { reduced?: boolean } = {},
): TransitionConfig {
  if (reduced) {
    return { duration: REDUCED_FADE, css: (t) => `opacity: ${t}` };
  }
  const height = node.offsetHeight;
  const fadeShare = FADE / (FADE + COLLAPSE);
  return {
    duration: FADE + COLLAPSE,
    css: (_t, u) => {
      if (u <= fadeShare) {
        return `opacity: ${1 - u / fadeShare}`;
      }
      const k = quintOut((u - fadeShare) / (1 - fadeShare));
      return `opacity: 0; overflow: hidden; height: ${height * (1 - k)}px`;
    },
  };
}
