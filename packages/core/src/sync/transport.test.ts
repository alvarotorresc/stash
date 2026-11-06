import { describe, expect, it } from 'vitest';
import { SyncError } from './errors';
import { createTransport } from './transport';

function answering(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return typeof body === 'string'
      ? new Response(body, { status, headers })
      : Response.json(body, { status, headers });
  };
  return { calls, transport: createTransport({ baseUrl: 'https://stash.test', fetch: fetchFn }) };
}

async function errorOf(promise: Promise<unknown>) {
  const error = (await promise.catch((e: unknown) => e)) as SyncError;
  return { code: error.code, status: error.status, retryAfter: error.retryAfter };
}

describe('createTransport', () => {
  it('should pull with the cursor in the query and the bearer token', async () => {
    const { calls, transport } = answering(200, {
      data: [],
      meta: { nextCursor: '7', hasMore: false },
    });

    const page = await transport.pull('tok', '5');
    const headers = new Headers(calls[0]?.init?.headers);

    expect({
      page,
      url: calls[0]?.url,
      auth: headers.get('Authorization'),
      credentials: calls[0]?.init?.credentials,
    }).toEqual({
      page: { records: [], meta: { nextCursor: '7', hasMore: false } },
      url: 'https://stash.test/api/records?cursor=5',
      auth: 'Bearer tok',
      credentials: 'omit',
    });
  });

  it('should push the operations as JSON', async () => {
    const results = [{ id: 'a', applied: true, version: 1 }];
    const { calls, transport } = answering(200, { data: { results } });

    const answer = await transport.push('tok', [{ op: 'delete', id: 'a', kind: 'item' }]);

    expect({ answer, body: calls[0]?.init?.body, method: calls[0]?.init?.method }).toEqual({
      answer: results,
      body: JSON.stringify({ operations: [{ op: 'delete', id: 'a', kind: 'item' }] }),
      method: 'POST',
    });
  });

  it('should report OFFLINE when the request does not get through', async () => {
    const transport = createTransport({
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });

    expect(await errorOf(transport.pull('tok', '0'))).toEqual({
      code: 'OFFLINE',
      status: 0,
      retryAfter: null,
    });
  });

  it.each([
    [401, 'UNAUTHORIZED', 'UNAUTHORIZED'],
    [413, 'QUOTA_EXCEEDED', 'QUOTA_EXCEEDED'],
    [413, 'PAYLOAD_TOO_LARGE', 'TOO_LARGE'],
    [409, 'CONFLICT', 'CONFLICT'],
    [500, 'INTERNAL_ERROR', 'SERVER_ERROR'],
    [400, 'VALIDATION_ERROR', 'BAD_RESPONSE'],
  ])('should map a %i %s to %s', async (status, code, expected) => {
    const { transport } = answering(status, { error: { code, message: 'x' } });

    expect((await errorOf(transport.pull('tok', '0'))).code).toBe(expected);
  });

  it('should keep Retry-After on a 429', async () => {
    const { transport } = answering(
      429,
      { error: { code: 'RATE_LIMITED', message: 'slow down' } },
      { 'Retry-After': '30' },
    );

    expect(await errorOf(transport.pull('tok', '0'))).toEqual({
      code: 'RATE_LIMITED',
      status: 429,
      retryAfter: 30,
    });
  });

  it.each([
    ['a body that is not JSON', 200, 'oops'],
    ['an error without a code', 500, { error: {} }],
    ['a page without meta', 200, { data: [] }],
    ['a page with a bad cursor', 200, { data: [], meta: { nextCursor: 3, hasMore: false } }],
  ])('should report BAD_RESPONSE for %s', async (_name, status, body) => {
    const { transport } = answering(status, body);

    expect((await errorOf(transport.pull('tok', '0'))).code).toBe('BAD_RESPONSE');
  });

  it('should report BAD_RESPONSE when the push results do not match the operations', async () => {
    const { transport } = answering(200, { data: { results: [] } });

    expect(
      (await errorOf(transport.push('tok', [{ op: 'delete', id: 'a', kind: 'item' }]))).code,
    ).toBe('BAD_RESPONSE');
  });
});
