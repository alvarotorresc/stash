import { jsonData, jsonError } from './http';

export default {
  async fetch(request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/health') {
      if (request.method !== 'GET') {
        return jsonError('METHOD_NOT_ALLOWED', 'Method not allowed', 405, { Allow: 'GET' });
      }
      return jsonData({ ok: true });
    }

    return jsonError('NOT_FOUND', 'Not found', 404);
  },
} satisfies ExportedHandler;
