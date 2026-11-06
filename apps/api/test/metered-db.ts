/**
 * Wraps a D1 database to add up the rows that its batches write (`meta.rows_written`), which
 * is what D1 bills and what the daily Free plan quota counts.
 */
export function meteredDb(db: D1Database): { db: D1Database; written: () => number } {
  let written = 0;
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          const results = await target.batch(statements);
          for (const result of results) written += result.meta.rows_written;
          return results;
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
  return { db: proxy, written: () => written };
}
