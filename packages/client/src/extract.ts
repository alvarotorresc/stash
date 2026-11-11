import type { ExtractData, ExtractErrorCode } from '@stash/core/extract';

export const EXTRACT_PATH = '/api/extract';

export type ExtractFailure = ExtractErrorCode | 'NETWORK_ERROR' | 'BAD_RESPONSE';

/**
 * Failures that will not change by asking again: the link is kept with what is known (its URL)
 * instead of being retried against the per-account extraction limit.
 */
const PERMANENT: ReadonlySet<ExtractFailure> = new Set<ExtractFailure>([
  'VALIDATION_ERROR',
  'URL_NOT_ALLOWED',
  'TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'UPSTREAM_ERROR',
  'UPSTREAM_TIMEOUT',
]);

export class ExtractError extends Error {
  constructor(
    readonly code: ExtractFailure,
    readonly status: number | null = null,
  ) {
    super(`Extraction failed: ${code}`);
    this.name = 'ExtractError';
  }

  /** True when asking again would give the same answer. */
  get permanent(): boolean {
    return PERMANENT.has(this.code);
  }
}

export interface ExtractorOptions {
  /** Origin of the API; empty for the same origin. */
  readonly baseUrl?: string;
  readonly fetch?: typeof fetch;
}

export type Extractor = (token: string, url: string) => Promise<ExtractData>;

const KINDS: ReadonlySet<string> = new Set(['web', 'reddit', 'x', 'instagram', 'tiktok']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * `POST /api/extract`: the proxy downloads the page and hands back the raw documents. The URL
 * goes in the body, never in the query string, and no cookie or cache is involved.
 */
export function createExtractor({
  baseUrl = '',
  fetch: fetchFn,
}: ExtractorOptions = {}): Extractor {
  return async (token, url) => {
    let response: Response;
    try {
      response = await (fetchFn ?? globalThis.fetch)(`${baseUrl}${EXTRACT_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url }),
        credentials: 'omit',
        cache: 'no-store',
      });
    } catch {
      throw new ExtractError('NETWORK_ERROR');
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    if (response.ok && isObject(json) && isObject(json.data) && KINDS.has(String(json.data.kind))) {
      return json.data as unknown as ExtractData;
    }
    if (isObject(json) && isObject(json.error) && typeof json.error.code === 'string') {
      throw new ExtractError(json.error.code as ExtractErrorCode, response.status);
    }
    throw new ExtractError('BAD_RESPONSE', response.status);
  };
}
