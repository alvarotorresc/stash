import {
  RECORDS_PATH,
  type PushOperation,
  type PushResult,
  type RecordKind,
  type WireRecord,
} from '../sync/protocol';

interface Row {
  kind: RecordKind;
  version: number;
  blob: string | null;
}

/**
 * In-memory stand-in for `/api/records` with the Worker's semantics (create only if new, last
 * write wins on put, tombstones, versions per account, first load without tombstones). The real
 * Worker is tested in apps/api; this drives the client through fetch.
 */
export class FakeRecordsServer {
  /** Rows per bearer token (one token = one account in these tests). */
  readonly accounts = new Map<string, Map<string, Row>>();
  readonly pushes: PushOperation[][] = [];
  pulls = 0;
  /** When true, every request fails as if there were no connection. */
  offline = false;
  /** Page size the server uses for pulls. */
  pageSize = 100;
  /** Answer the next request with this status and code instead. */
  nextError: { status: number; code: string; retryAfter?: string } | null = null;
  /** Runs before a pull answers, to interleave events in tests. */
  beforePull: (() => void | Promise<void>) | null = null;
  #versions = new Map<string, number>();

  rows(token = 'token-a'): Map<string, Row> {
    let rows = this.accounts.get(token);
    if (rows === undefined) {
      rows = new Map();
      this.accounts.set(token, rows);
    }
    return rows;
  }

  head(token = 'token-a'): number {
    return this.#versions.get(token) ?? 0;
  }

  /** Forgets every row and version of the account, as if the database were restored empty. */
  restore(token = 'token-a'): void {
    this.accounts.delete(token);
    this.#versions.delete(token);
  }

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const token = new Headers(init?.headers).get('Authorization')?.slice(7) ?? '';
    if (url.pathname !== RECORDS_PATH) return this.error(404, 'NOT_FOUND');
    if (this.nextError !== null) {
      const { status, code, retryAfter } = this.nextError;
      this.nextError = null;
      return this.error(status, code, retryAfter);
    }
    if (init?.method === 'POST') {
      const { operations } = JSON.parse(String(init.body)) as { operations: PushOperation[] };
      this.pushes.push(operations);
      return Response.json({ data: { results: operations.map((op) => this.apply(token, op)) } });
    }
    this.pulls += 1;
    await this.beforePull?.();
    return this.pull(token, Number(url.searchParams.get('cursor') ?? '0'));
  };

  private error(status: number, code: string, retryAfter?: string): Response {
    const headers: Record<string, string> =
      retryAfter === undefined ? {} : { 'Retry-After': retryAfter };
    return Response.json({ error: { code, message: code } }, { status, headers });
  }

  private next(token: string): number {
    const version = this.head(token) + 1;
    this.#versions.set(token, version);
    return version;
  }

  private apply(token: string, op: PushOperation): PushResult {
    const rows = this.rows(token);
    const row = rows.get(op.id);
    if (op.op === 'delete') {
      if (row === undefined || row.blob === null) {
        return { id: op.id, applied: false, version: row?.version ?? null };
      }
      row.blob = null;
      row.version = this.next(token);
      return { id: op.id, applied: true, version: row.version };
    }
    if (op.op === 'create' && row !== undefined) {
      return { id: op.id, applied: false, version: row.version };
    }
    if (row !== undefined && row.blob === op.blob) {
      return { id: op.id, applied: false, version: row.version };
    }
    const version = this.next(token);
    rows.set(op.id, { kind: op.kind, version, blob: op.blob });
    return { id: op.id, applied: true, version };
  }

  private pull(token: string, cursor: number): Response {
    const all = [...this.rows(token).entries()]
      .filter(([, row]) => row.version > cursor && (cursor > 0 || row.blob !== null))
      .sort(([, a], [, b]) => a.version - b.version);
    const page = all.slice(0, this.pageSize);
    const hasMore = all.length > page.length;
    const data: WireRecord[] = page.map(([id, row]) => ({
      id,
      kind: row.kind,
      version: row.version,
      deleted: row.blob === null,
      blob: row.blob,
    }));
    const last = page.at(-1)?.[1].version;
    return Response.json({
      data,
      meta: { nextCursor: String(hasMore ? last : this.head(token)), hasMore },
    });
  }
}
