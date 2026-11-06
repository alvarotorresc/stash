import { resolveSession } from './auth/session';
import { createExtractRoutes, DEFAULT_LIMITS } from './extract/routes';
import { jsonData, jsonError } from './http';
import { allowAll } from './rate-limit';

const extractRoutes = createExtractRoutes({
  fetch: (input, init) => fetch(input, init),
  resolveSession,
  rateLimiter: allowAll,
  limits: DEFAULT_LIMITS,
});

export default {
  async fetch(request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      if (request.method !== 'GET') {
        return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { Allow: 'GET' });
      }
      return jsonData({ ok: true });
    }

    const extractResponse = await extractRoutes(request, pathname);
    if (extractResponse) return extractResponse;

    return jsonError('NOT_FOUND', 'Not found', 404);
  },
} satisfies ExportedHandler;
