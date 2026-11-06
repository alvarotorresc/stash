import { describe, expect, it } from 'vitest';
import { ExtractError, createExtractor } from './extract';
import { webPage } from './test/backend';

const URL_A = 'https://example.com/a';

async function failureOf(promise: Promise<unknown>) {
  const error = await promise.catch((e: unknown) => e);
  return error instanceof ExtractError
    ? { code: error.code, status: error.status, permanent: error.permanent }
    : error;
}

describe('createExtractor', () => {
  it('should send the URL in a JSON body with the bearer token and no cookies', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const extract = createExtractor({
      baseUrl: 'https://stash.test',
      fetch: async (input, init) => {
        seen.push({ url: String(input), init });
        return Response.json({ data: webPage(URL_A, 'A', ['x']) });
      },
    });

    const data = await extract('token-1', URL_A);
    const [call] = seen;

    expect({
      kind: data.kind,
      url: call?.url,
      body: call?.init?.body,
      auth: new Headers(call?.init?.headers).get('Authorization'),
      credentials: call?.init?.credentials,
    }).toEqual({
      kind: 'web',
      url: 'https://stash.test/api/extract',
      body: JSON.stringify({ url: URL_A }),
      auth: 'Bearer token-1',
      credentials: 'omit',
    });
  });

  it('should fail with NETWORK_ERROR without connection, which is worth retrying', async () => {
    const extract = createExtractor({
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    });

    expect(await failureOf(extract('t', URL_A))).toEqual({
      code: 'NETWORK_ERROR',
      status: null,
      permanent: false,
    });
  });

  it.each([
    { status: 502, code: 'UPSTREAM_ERROR', permanent: true },
    { status: 400, code: 'URL_NOT_ALLOWED', permanent: true },
    { status: 429, code: 'RATE_LIMITED', permanent: false },
    { status: 401, code: 'UNAUTHORIZED', permanent: false },
  ])('should pass on $code from the proxy', async ({ status, code, permanent }) => {
    const extract = createExtractor({
      fetch: async () => Response.json({ error: { code, message: code } }, { status }),
    });

    expect(await failureOf(extract('t', URL_A))).toEqual({ code, status, permanent });
  });

  it('should fail with BAD_RESPONSE when the answer has no known kind', async () => {
    const extract = createExtractor({
      fetch: async () => new Response('<html>not json</html>', { status: 200 }),
    });
    const unknownKind = createExtractor({
      fetch: async () => Response.json({ data: { kind: 'tiktok' } }),
    });

    expect([
      await failureOf(extract('t', URL_A)),
      await failureOf(unknownKind('t', URL_A)),
    ]).toEqual([
      { code: 'BAD_RESPONSE', status: 200, permanent: false },
      { code: 'BAD_RESPONSE', status: 200, permanent: false },
    ]);
  });
});
