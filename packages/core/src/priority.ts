/** Priority of a saved item, from most to least important. */
export const PRIORITIES = ['high', 'medium', 'low'] as const;

export type Priority = (typeof PRIORITIES)[number];

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value);
}
