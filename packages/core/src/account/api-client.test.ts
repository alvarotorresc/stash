import { describe, expect, it, vi } from 'vitest';
import { AccountApiError, createApiCall } from './api-client';

function respond(body: unknown, init: ResponseInit = {}): typeof fetch {
  return vi.fn(async () =>
    typeof body === 'string' ? new Response(body, init) : Response.json(body, init),
  );
}

async function failure(call: Promise<unknown>): Promise<AccountApiError> {
  return (await call.catch((error: unknown) => error)) as AccountApiError;
}

describe('createApiCall', () => {
  it('should return the data of a successful envelope', async () => {
    const api = createApiCall({ fetch: respond({ data: { ok: true } }) });

    expect(await api({ method: 'GET', path: '/api/x' })).toEqual({ ok: true });
  });

  it('should send json, the bearer token and no cookies to the base url', async () => {
    const fetchFn = respond({ data: null });
    const api = createApiCall({ baseUrl: 'https://stash.test', fetch: fetchFn });

    await api({ method: 'POST', path: '/api/x', body: { a: 1 }, token: 'tok' });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect({
      url,
      body: init.body,
      credentials: init.credentials,
      auth: headers.Authorization,
      type: headers['Content-Type'],
    }).toEqual({
      url: 'https://stash.test/api/x',
      body: '{"a":1}',
      credentials: 'omit',
      auth: 'Bearer tok',
      type: 'application/json',
    });
  });

  it('should use the global fetch and the same origin by default', async () => {
    const fetchFn = respond({ data: 1 });
    vi.stubGlobal('fetch', fetchFn);

    await createApiCall()({ method: 'GET', path: '/api/x' });

    expect(vi.mocked(fetchFn).mock.calls[0]?.[0]).toBe('/api/x');
    vi.unstubAllGlobals();
  });

  it('should throw the server error code and status', async () => {
    const api = createApiCall({
      fetch: respond({ error: { code: 'EMAIL_TAKEN', message: 'Taken' } }, { status: 409 }),
    });

    const error = await failure(api({ method: 'POST', path: '/api/x' }));

    expect([error.code, error.status, error.message, error.retryAfter]).toEqual([
      'EMAIL_TAKEN',
      409,
      'Taken',
      null,
    ]);
  });

  it('should expose Retry-After on a 429', async () => {
    const api = createApiCall({
      fetch: respond(
        { error: { code: 'RATE_LIMITED' } },
        { status: 429, headers: { 'Retry-After': '42' } },
      ),
    });

    const error = await failure(api({ method: 'POST', path: '/api/x' }));

    expect([error.code, error.retryAfter, error.message]).toEqual([
      'RATE_LIMITED',
      42,
      'Request failed',
    ]);
  });

  it('should report NETWORK_ERROR when fetch rejects', async () => {
    const api = createApiCall({ fetch: vi.fn().mockRejectedValue(new TypeError('offline')) });

    expect((await failure(api({ method: 'GET', path: '/api/x' }))).code).toBe('NETWORK_ERROR');
  });

  it.each([
    ['a body that is not json', 'oops', 502],
    ['json without an envelope', { hello: 1 }, 200],
  ])('should report BAD_RESPONSE for %s', async (_case, body, status) => {
    const api = createApiCall({ fetch: respond(body, { status }) });

    const error = await failure(api({ method: 'GET', path: '/api/x' }));

    expect([error.code, error.status]).toEqual(['BAD_RESPONSE', status]);
  });
});
