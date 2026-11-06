import type { Session, SessionResolver } from '../src/auth/session';
import { createExtractRoutes, DEFAULT_LIMITS, type ExtractLimits } from '../src/extract/routes';
import type { Fetcher } from '../src/extract/safe-fetch';
import type { RateLimiter } from '../src/rate-limit';

export const SESSION: Session = { accountId: 'account-1' };
export const withSession: SessionResolver = async () => SESSION;

export interface AppOptions {
  fetch: Fetcher;
  resolveSession?: SessionResolver;
  rateLimiter?: RateLimiter;
  limits?: Partial<ExtractLimits>;
}

/** Extraction routes with injected outbound fetch and a valid session by default. */
export function app(options: AppOptions) {
  const routes = createExtractRoutes({
    fetch: options.fetch,
    resolveSession: options.resolveSession ?? withSession,
    rateLimiter: options.rateLimiter ?? { limit: async () => ({ success: true }) },
    limits: { ...DEFAULT_LIMITS, ...options.limits },
  });
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    const request = new Request(`https://stash.test${path}`, init);
    const response = await routes(request, new URL(request.url).pathname);
    if (!response) throw new Error('route not handled');
    return response;
  };
}

export function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
