/**
 * `POST /api/extract` and `POST /api/extract/image` (D10, D35, D36).
 *
 * The proxy downloads and forgets: nothing is stored and the URL is never logged nor echoed, not
 * even in errors. The URL travels in the JSON body, never in the query string.
 */

import { EXTRACT_MAX_URL_LENGTH, type ExtractErrorCode } from '@stash/core/extract';
import { requireSession, type Session, type SessionResolver } from '../auth/session';
import { jsonData, jsonError } from '../http';
import type { RateLimiter } from '../rate-limit';
import { fetchImage } from './image';
import { readBounded, UpstreamError, type Fetcher, type UpstreamErrorCode } from './safe-fetch';
import { extract, type DocumentLimits } from './sources';
import { parseAllowedTarget } from './url-guard';

export const EXTRACT_PATH = '/api/extract';
export const EXTRACT_IMAGE_PATH = '/api/extract/image';

export interface ExtractLimits extends DocumentLimits {
  maxImageBytes: number;
  maxRedirects: number;
  /** Deadline of a whole extraction, redirects and body read included. */
  timeoutMs: number;
}

export const DEFAULT_LIMITS: ExtractLimits = {
  maxDocumentBytes: 2 * 1024 * 1024,
  maxJsonBytes: 256 * 1024,
  maxImageBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  timeoutMs: 10_000,
};

export interface ExtractDeps {
  fetch: Fetcher;
  resolveSession: SessionResolver;
  rateLimiter: RateLimiter;
  limits: ExtractLimits;
}

/** Request bodies are tiny (`{ "url": "…" }`); anything bigger is rejected unread. */
const MAX_REQUEST_BYTES = 4 * 1024;

const MESSAGES: Record<UpstreamErrorCode, [string, number]> = {
  URL_NOT_ALLOWED: ['This address cannot be fetched', 400],
  UNSUPPORTED_MEDIA_TYPE: ['The content type is not supported', 415],
  TOO_LARGE: ['The content is too large', 413],
  UPSTREAM_ERROR: ['The site could not be fetched', 502],
  UPSTREAM_TIMEOUT: ['The site took too long to answer', 504],
};

class RequestError extends Error {
  constructor(
    public readonly code: ExtractErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function readTarget(request: Request): Promise<URL> {
  if (new URL(request.url).search !== '') {
    throw new RequestError('VALIDATION_ERROR', 'The URL must be sent in the body', 400);
  }
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json\s*(;|$)/i.test(contentType)) {
    throw new RequestError('UNSUPPORTED_MEDIA_TYPE', 'The body must be JSON', 415);
  }

  let payload: unknown;
  try {
    const { bytes } = await readBounded(
      request,
      MAX_REQUEST_BYTES,
      'reject',
      new AbortController().signal,
    );
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError('VALIDATION_ERROR', 'Invalid request body', 400);
  }

  const url = (payload as { url?: unknown } | null)?.url;
  if (typeof url !== 'string' || url.length === 0 || url.length > EXTRACT_MAX_URL_LENGTH) {
    throw new RequestError('VALIDATION_ERROR', 'A valid url is required', 400);
  }
  const target = parseAllowedTarget(url);
  if (!target) throw new RequestError('URL_NOT_ALLOWED', MESSAGES.URL_NOT_ALLOWED[0], 400);
  return target;
}

function errorResponse(error: unknown): Response {
  if (error instanceof RequestError) return jsonError(error.code, error.message, error.status);
  if (error instanceof UpstreamError) {
    const [message, status] = MESSAGES[error.code];
    return jsonError(error.code, message, status);
  }
  // Unexpected: report only the error type; its message could quote the URL.
  console.error('extract: unexpected error', error instanceof Error ? error.name : typeof error);
  return jsonError('INTERNAL_ERROR', 'Internal error', 500);
}

export function createExtractRoutes(deps: ExtractDeps) {
  const { limits } = deps;

  async function guarded(
    request: Request,
    session: Session,
    run: (target: URL, signal: AbortSignal) => Promise<Response>,
  ): Promise<Response> {
    const { success } = await deps.rateLimiter.limit({ key: session.accountId });
    if (!success) return jsonError('RATE_LIMITED', 'Too many requests', 429);
    try {
      const target = await readTarget(request);
      return await run(target, AbortSignal.timeout(limits.timeoutMs));
    } catch (error) {
      return errorResponse(error);
    }
  }

  const page = requireSession(deps.resolveSession, (request, session) =>
    guarded(request, session, async (target, signal) =>
      jsonData(
        await extract(target, {
          fetch: deps.fetch,
          signal,
          maxRedirects: limits.maxRedirects,
          limits,
        }),
      ),
    ),
  );

  const image = requireSession(deps.resolveSession, (request, session) =>
    guarded(request, session, async (target, signal) => {
      const { bytes, type } = await fetchImage(
        target,
        { fetch: deps.fetch, signal, maxRedirects: limits.maxRedirects },
        limits.maxImageBytes,
      );
      return new Response(bytes, {
        headers: {
          'Content-Type': type,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    }),
  );

  /** Returns null when the path is not an extraction route. */
  return async (request: Request, pathname: string): Promise<Response | null> => {
    if (pathname !== EXTRACT_PATH && pathname !== EXTRACT_IMAGE_PATH) return null;
    if (request.method !== 'POST') {
      return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { Allow: 'POST' });
    }
    return pathname === EXTRACT_PATH ? page(request) : image(request);
  };
}
