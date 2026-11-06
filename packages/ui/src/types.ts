import type { Priority } from '@stash/core';

export type { Priority };

/** Thumbnail placeholder tone when there is no saved image (--t1 to --t4). */
export type Tone = 1 | 2 | 3 | 4;

export interface CategoryOption {
  id: string;
  name: string;
}

export interface TagSuggestion {
  name: string;
  /** How many saved items use this tag. */
  count: number;
}

/** Labels for the three priorities, in display order. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  high: 'Alta',
  medium: 'Media',
  low: 'Baja',
};

/**
 * HTML that has already been sanitized by the caller. The kit renders it as
 * is and never sanitizes; the brand keeps raw strings from slipping in.
 */
export type SanitizedHtml = string & { readonly __brand: 'SanitizedHtml' };

export interface ImageData {
  src: string;
  alt: string;
}
