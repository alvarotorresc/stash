import type { ParsedOperation } from './validation';

/**
 * A push is rate limited by the rows it can write to D1, not by the request, so a few large
 * pushes and many small ones spend the same share of the daily write quota.
 * `test/write-budget.test.ts` measures these costs on the real schema and fails if any falls
 * short of what the statement writes.
 */

/** The push's own counters: a new per-account key (and its later sweep) and the global key. */
export const PUSH_REQUEST_ROWS = 3;

/**
 * Rows of each operation. A new record writes its row, its two index entries and its
 * `record_counts` update; an edit or a delete rewrites the row and its version entry. A put may
 * insert a new record, and telling would need reading the records before the request is
 * counted, which a refused push must not cost, so it is charged as a new record.
 */
export const OPERATION_ROWS = { create: 4, put: 4, delete: 3 } as const satisfies Record<
  ParsedOperation['op'],
  number
>;

/** The first record of an account also creates its `record_counts` row. */
export const FIRST_RECORD_ROWS = 1;

/** The weight a push is counted with: an upper bound of the rows it writes. */
export function pushWeight(operations: readonly ParsedOperation[]): number {
  let weight = PUSH_REQUEST_ROWS;
  let inserts = false;
  for (const { op } of operations) {
    weight += OPERATION_ROWS[op];
    if (op !== 'delete') inserts = true;
  }
  return inserts ? weight + FIRST_RECORD_ROWS : weight;
}
