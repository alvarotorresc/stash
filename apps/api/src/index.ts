import { handleAccountsRequest, isAccountsPath } from './accounts/routes';
import type { AccountsEnv } from './accounts/env';
import { readPepper } from './accounts/env';
import { createExtractRateLimiter } from './accounts/rate-limit';
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

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

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
} satisfies ExportedHandler<AccountsEnv>;
