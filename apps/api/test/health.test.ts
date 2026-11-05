import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const BASE_URL = 'https://stash.test';

describe('GET /api/health', () => {
  it('should answer ok with the standard data envelope', async () => {
    const res = await exports.default.fetch(`${BASE_URL}/api/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
  });

  it('should never be cached', async () => {
    const res = await exports.default.fetch(`${BASE_URL}/api/health`);

    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('should reject other methods with a 405 error envelope', async () => {
    const res = await exports.default.fetch(`${BASE_URL}/api/health`, { method: 'POST' });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect(await res.json()).toEqual({
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' },
    });
  });
});

describe('unknown routes', () => {
  it('should answer 404 with the standard error envelope', async () => {
    const res = await exports.default.fetch(`${BASE_URL}/api/unknown`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
});
