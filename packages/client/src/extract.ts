import {
  EXTRACT_IMAGE_TYPES,
  EXTRACT_MAX_IMAGE_BYTES,
  type ExtractData,
  type ExtractErrorCode,
  type ExtractImageType,
} from '@stash/core/extract';

export const EXTRACT_PATH = '/api/extract';
export const EXTRACT_IMAGE_PATH = '/api/extract/image';

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

/** An image the proxy downloaded: raw bytes, still to be reduced on the device. */
export interface FetchedImage {
  readonly bytes: Uint8Array;
  readonly type: ExtractImageType;
}

export type ImageFetcher = (token: string, url: string) => Promise<FetchedImage>;

const IMAGE_TYPES: ReadonlySet<string> = new Set(EXTRACT_IMAGE_TYPES);

function isImageType(type: string): type is ExtractImageType {
  return IMAGE_TYPES.has(type);
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `POST /api/extract/image`: the proxy downloads the preview image and hands back its bytes, so
 * the device never contacts the site that serves it. Anything that is not an http(s) address
 * (`data:`, relative paths) is refused here without a request, and the answer is checked again:
 * only the raster types of the contract, never SVG, and at most the proxy's size limit.
 */
export function createImageFetcher({
  baseUrl = '',
  fetch: fetchFn,
}: ExtractorOptions = {}): ImageFetcher {
  return async (token, url) => {
    if (!isHttpUrl(url)) throw new ExtractError('URL_NOT_ALLOWED');
    let response: Response;
    try {
      response = await (fetchFn ?? globalThis.fetch)(`${baseUrl}${EXTRACT_IMAGE_PATH}`, {
        method: 'POST',
        headers: {
          Accept: 'image/*',
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
    if (!response.ok) {
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        json = undefined;
      }
      if (isObject(json) && isObject(json.error) && typeof json.error.code === 'string') {
        throw new ExtractError(json.error.code as ExtractErrorCode, response.status);
      }
      throw new ExtractError('BAD_RESPONSE', response.status);
    }
    const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (!type || !isImageType(type)) {
      void response.body?.cancel().catch(() => undefined);
      throw new ExtractError('UNSUPPORTED_MEDIA_TYPE', response.status);
    }
    const declared = Number(response.headers.get('content-length'));
    if (declared > EXTRACT_MAX_IMAGE_BYTES) {
      void response.body?.cancel().catch(() => undefined);
      throw new ExtractError('TOO_LARGE', response.status);
    }
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new ExtractError('NETWORK_ERROR');
    }
    if (bytes.byteLength > EXTRACT_MAX_IMAGE_BYTES) {
      throw new ExtractError('TOO_LARGE', response.status);
    }
    if (bytes.byteLength === 0) throw new ExtractError('BAD_RESPONSE', response.status);
    return { bytes, type };
  };
}
