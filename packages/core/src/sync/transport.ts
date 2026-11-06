import {
  RECORDS_PATH,
  type PullMeta,
  type PushOperation,
  type PushResponse,
  type PushResult,
  type WireRecord,
} from './protocol';
import { SyncError, type SyncErrorCode } from './errors';

export interface TransportOptions {
  /** Origin of the API, such as `https://stash.alvarotc.com`; empty for the same origin. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export interface PullPage {
  readonly records: readonly WireRecord[];
  readonly meta: PullMeta;
}

export interface Transport {
  push(token: string, operations: readonly PushOperation[]): Promise<readonly PushResult[]>;
  pull(token: string, cursor: string): Promise<PullPage>;
}

const SERVER_CODES: Partial<Record<string, SyncErrorCode>> = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  PAYLOAD_TOO_LARGE: 'TOO_LARGE',
  CONFLICT: 'CONFLICT',
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function badResponse(status: number): SyncError {
  return new SyncError('BAD_RESPONSE', 'Unexpected response', status);
}

/** HTTP calls to `/api/records` with the bearer token and the `{ data, meta }` envelope. */
export function createTransport({
  baseUrl = '',
  fetch: fetchFn,
}: TransportOptions = {}): Transport {
  async function request(
    token: string,
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
  ): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await (fetchFn ?? globalThis.fetch)(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new SyncError('OFFLINE', 'Could not reach the server');
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    if (response.ok && isObject(json) && 'data' in json) return json;
    if (isObject(json) && isObject(json.error) && typeof json.error.code === 'string') {
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new SyncError(
        SERVER_CODES[json.error.code] ?? (response.status >= 500 ? 'SERVER_ERROR' : 'BAD_RESPONSE'),
        typeof json.error.message === 'string' ? json.error.message : 'Request failed',
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    }
    throw badResponse(response.status);
  }

  return {
    async push(token, operations) {
      const json = await request(token, RECORDS_PATH, { method: 'POST', body: { operations } });
      const results = (json.data as PushResponse | null)?.results;
      if (!Array.isArray(results) || results.length !== operations.length) throw badResponse(200);
      return results;
    },

    async pull(token, cursor) {
      const json = await request(token, `${RECORDS_PATH}?cursor=${encodeURIComponent(cursor)}`, {
        method: 'GET',
      });
      const meta = json.meta as PullMeta | undefined;
      if (
        !Array.isArray(json.data) ||
        !isObject(meta) ||
        typeof meta.nextCursor !== 'string' ||
        typeof meta.hasMore !== 'boolean'
      ) {
        throw badResponse(200);
      }
      return { records: json.data as WireRecord[], meta };
    },
  };
}
