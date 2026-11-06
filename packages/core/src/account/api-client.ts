import type { AccountErrorCode } from './protocol';

/**
 * A failed call to the account API. `code` is the server's error code, or `NETWORK_ERROR`
 * when no answer arrived and `BAD_RESPONSE` when the answer was not the expected envelope.
 */
export class AccountApiError extends Error {
  constructor(
    readonly code: AccountErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE',
    message: string,
    readonly status: number,
    /** Seconds to wait before retrying, from `Retry-After` on a 429. */
    readonly retryAfter: number | null = null,
  ) {
    super(message);
    this.name = 'AccountApiError';
  }
}

export interface ApiClientOptions {
  /** Origin of the API, such as `https://stash.alvarotc.com`; empty for the same origin. */
  readonly baseUrl?: string;
  /** Injectable for tests and for clients that need their own fetch. */
  readonly fetch?: typeof fetch;
}

export interface ApiRequest {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly token?: string;
}

export type ApiCall = <T>(request: ApiRequest) => Promise<T>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** JSON calls with the `{ data }` / `{ error }` envelope and an optional bearer token. */
export function createApiCall({ baseUrl = '', fetch: fetchFn }: ApiClientOptions = {}): ApiCall {
  return async <T>({ method, path, body, token }: ApiRequest): Promise<T> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token !== undefined) headers.Authorization = `Bearer ${token}`;
    const doFetch = fetchFn ?? globalThis.fetch;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new AccountApiError('NETWORK_ERROR', 'Could not reach the server', 0);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    if (response.ok && isObject(json) && 'data' in json) return json.data as T;
    if (isObject(json) && isObject(json.error) && typeof json.error.code === 'string') {
      const retryAfter = Number(response.headers.get('Retry-After'));
      throw new AccountApiError(
        json.error.code as AccountErrorCode,
        typeof json.error.message === 'string' ? json.error.message : 'Request failed',
        response.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      );
    }
    throw new AccountApiError('BAD_RESPONSE', 'Unexpected response', response.status);
  };
}
