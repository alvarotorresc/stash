import { handleAccountsRequest, isAccountsPath } from './accounts/routes';
import type { AccountsEnv } from './accounts/env';
import { readPepper } from './accounts/env';
import { createExtractRateLimiter } from './accounts/rate-limit';
import { sweepExpiredRows } from './accounts/sweep';
import { createSessionResolver } from './auth/session';
import { createExtractRoutes, DEFAULT_LIMITS } from './extract/routes';
import { jsonData, jsonError } from './http';

/** Extraction routes bound to this request's bindings: real sessions and D1 rate limits. */
function extractRoutesFor(env: AccountsEnv) {
  return createExtractRoutes({
    fetch: (input, init) => fetch(input, init),
    resolveSession: createSessionResolver(env),
    rateLimiter: {
      // Reads the pepper lazily, so a missing secret fails inside the route's error handling.
      limit: (options) => createExtractRateLimiter(env.DB, readPepper(env)).limit(options),
    },
    limits: DEFAULT_LIMITS,
  });
}

/**
 * Browsers mark a request sent by another site's page with `Sec-Fetch-Site: cross-site`. The
 * API only serves the PWA on its own origin, so those are refused before any work. Clients that
 * are not browsers do not send the header and go through; the browser extension will need its
 * own exception for its origin.
 */
function isCrossSite(request: Request): boolean {
  return request.headers.get('Sec-Fetch-Site') === 'cross-site';
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith('/api/') && isCrossSite(request)) {
      return jsonError('CROSS_SITE_REQUEST', 'Requests from other sites are not allowed', 403);
    }

    if (pathname === '/api/health') {
      if (request.method !== 'GET') {
        return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { Allow: 'GET' });
      }
      return jsonData({ ok: true });
    }

    if (isAccountsPath(pathname)) return handleAccountsRequest(request, env);

    const extractResponse = await extractRoutesFor(env)(request, pathname);
    if (extractResponse) return extractResponse;

    return jsonError('NOT_FOUND', 'Not found', 404);
  },

  /** Daily cron trigger: deletes expired sessions and dead rate limit windows. */
  async scheduled(controller, env): Promise<void> {
    await sweepExpiredRows(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<AccountsEnv>;
