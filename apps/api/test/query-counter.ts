/**
 * Wraps a D1 database to count the queries a Worker invocation sends, as the D1 limit of
 * queries per invocation counts them: each statement run on its own (`run`, `first`, `all`,
 * `raw`) is one query, and a `batch` is one query however many statements it holds.
 */
export function countingDb(db: D1Database): { db: D1Database; queries: () => number } {
  let queries = 0;
  const targets = new WeakMap<object, D1PreparedStatement>();
  const terminal = new Set<PropertyKey>(['run', 'first', 'all', 'raw']);

  function wrap(statement: D1PreparedStatement): D1PreparedStatement {
    const proxy = new Proxy(statement, {
      get(target, property) {
        if (property === 'bind') {
          return (...values: unknown[]) => wrap(target.bind(...values));
        }
        const value: unknown = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        const method = value as (...args: unknown[]) => unknown;
        if (!terminal.has(property)) return method.bind(target);
        return (...args: unknown[]) => {
          queries += 1;
          return method.apply(target, args);
        };
      },
    });
    targets.set(proxy, statement);
    return proxy;
  }

  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') return (sql: string) => wrap(target.prepare(sql));
      if (property === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          queries += 1;
          return target.batch(statements.map((statement) => targets.get(statement) ?? statement));
        };
      }
      if (property === 'exec') {
        return (sql: string) => {
          queries += 1;
          return target.exec(sql);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value;
    },
  });
  return { db: proxy, queries: () => queries };
}
