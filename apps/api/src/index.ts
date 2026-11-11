import { handleAccountsRequest, isAccountsPath } from './accounts/routes';
import type { AccountsEnv } from './accounts/env';
import { readPepper } from './accounts/env';
import { createExtractRateLimiter } from './accounts/rate-limit';
import { sweepExpiredRows } from './accounts/sweep';
import { createSessionResolver } from './auth/session';
import { createExtractRoutes, DEFAULT_LIMITS } from './extract/routes';
import { jsonData, jsonError } from './http';
import { handleRecordsRequest, isRecordsPath } from './records/routes';

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
 * The origin of a browser extension, in the exact shape each browser gives it: Chrome's id is 32
 * letters from a to p, Firefox's is a random UUID per installation (so it cannot be pinned). A
 * web page cannot send either: `Origin` is set by the browser, never by page script.
 */
const EXTENSION_ORIGIN =
  /^(?:chrome-extension:\/\/[a-p]{32}|moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * Browsers mark a request sent by another site's page with `Sec-Fetch-Site: cross-site`. The
 * app is served on this origin, so those are refused before any work, except the ones the
 * browser extension sends from its own origin (the API reads no cookies, see the README).
 * Clients that are not browsers do not send the header and go through.
 */
function isCrossSite(request: Request): boolean {
  if (request.headers.get('Sec-Fetch-Site') !== 'cross-site') return false;
  return !EXTENSION_ORIGIN.test(request.headers.get('Origin') ?? '');
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
    if (isRecordsPath(pathname)) return handleRecordsRequest(request, env);

    const extractResponse = await extractRoutesFor(env)(request, pathname);
    if (extractResponse) return extractResponse;

    return jsonError('NOT_FOUND', 'Not found', 404);
  },

  /** Daily cron trigger: deletes expired sessions and dead rate limit windows. */
  async scheduled(controller, env): Promise<void> {
    await sweepExpiredRows(env.DB, controller.scheduledTime);
  },
} satisfies ExportedHandler<AccountsEnv>;
