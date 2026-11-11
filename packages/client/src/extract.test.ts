import { describe, expect, it } from 'vitest';
import { ExtractError, createExtractor, createImageFetcher } from './extract';
import { EXTRACT_MAX_IMAGE_BYTES } from '@stash/core/extract';
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

  it('should accept the TikTok answer', async () => {
    const extract = createExtractor({
      fetch: async () => Response.json({ data: { kind: 'tiktok', oembed: null, page: null } }),
    });

    expect((await extract('t', URL_A)).kind).toBe('tiktok');
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
      fetch: async () => Response.json({ data: { kind: 'mastodon' } }),
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

const IMAGE_URL = 'https://pbs.twimg.com/media/photo.jpg';

describe('createImageFetcher', () => {
  it('should ask the proxy, never the third party, with the URL in the body', async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImage = createImageFetcher({
      baseUrl: 'https://stash.test',
      fetch: async (input, init) => {
        seen.push({ url: String(input), init });
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/jpeg' },
        });
      },
    });

    const image = await fetchImage('token-1', IMAGE_URL);
    const [call] = seen;

    expect({
      type: image.type,
      bytes: [...image.bytes],
      url: call?.url,
      body: call?.init?.body,
      auth: new Headers(call?.init?.headers).get('Authorization'),
      credentials: call?.init?.credentials,
    }).toEqual({
      type: 'image/jpeg',
      bytes: [1, 2, 3],
      url: 'https://stash.test/api/extract/image',
      body: JSON.stringify({ url: IMAGE_URL }),
      auth: 'Bearer token-1',
      credentials: 'omit',
    });
  });

  it.each([
    'data:image/png;base64,AAAA',
    '/relative.png',
    'javascript:alert(1)',
    'ftp://x.test/a.png',
  ])('should not even ask the proxy for %s', async (url) => {
    let calls = 0;
    const fetchImage = createImageFetcher({
      fetch: async () => {
        calls += 1;
        return new Response();
      },
    });

    expect(await failureOf(fetchImage('t', url))).toEqual({
      code: 'URL_NOT_ALLOWED',
      status: null,
      permanent: true,
    });
    expect(calls).toBe(0);
  });

  it.each(['image/svg+xml', 'text/html', 'application/json', ''])(
    'should refuse the content type "%s"',
    async (type) => {
      const fetchImage = createImageFetcher({
        fetch: async () => new Response('<svg/>', { headers: { 'Content-Type': type } }),
      });

      expect(await failureOf(fetchImage('t', IMAGE_URL))).toMatchObject({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        permanent: true,
      });
    },
  );

  it('should accept a content type with parameters and capitals', async () => {
    const fetchImage = createImageFetcher({
      fetch: async () =>
        new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'IMAGE/WEBP; q=1' } }),
    });

    expect((await fetchImage('t', IMAGE_URL)).type).toBe('image/webp');
  });

  it('should refuse a body over the limit, declared or not', async () => {
    const declared = createImageFetcher({
      fetch: async () =>
        new Response(new Uint8Array([1]), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(EXTRACT_MAX_IMAGE_BYTES + 1),
          },
        }),
    });
    const hidden = createImageFetcher({
      fetch: async () =>
        new Response(new Uint8Array(EXTRACT_MAX_IMAGE_BYTES + 1), {
          headers: { 'Content-Type': 'image/png' },
        }),
    });

    expect([
      (await failureOf(declared('t', IMAGE_URL))) as { code: string },
      (await failureOf(hidden('t', IMAGE_URL))) as { code: string },
    ]).toMatchObject([{ code: 'TOO_LARGE' }, { code: 'TOO_LARGE' }]);
  });

  it('should refuse an empty body', async () => {
    const fetchImage = createImageFetcher({
      fetch: async () =>
        new Response(new Uint8Array(), { headers: { 'Content-Type': 'image/png' } }),
    });

    expect(await failureOf(fetchImage('t', IMAGE_URL))).toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('should carry the proxy error, and a network failure stays worth retrying', async () => {
    const limited = createImageFetcher({
      fetch: async () =>
        Response.json({ error: { code: 'RATE_LIMITED', message: 'x' } }, { status: 429 }),
    });
    const gone = createImageFetcher({
      fetch: async () =>
        Response.json({ error: { code: 'UPSTREAM_ERROR', message: 'x' } }, { status: 502 }),
    });
    const offline = createImageFetcher({ fetch: () => Promise.reject(new TypeError('x')) });

    expect([
      await failureOf(limited('t', IMAGE_URL)),
      await failureOf(gone('t', IMAGE_URL)),
      await failureOf(offline('t', IMAGE_URL)),
    ]).toEqual([
      { code: 'RATE_LIMITED', status: 429, permanent: false },
      { code: 'UPSTREAM_ERROR', status: 502, permanent: true },
      { code: 'NETWORK_ERROR', status: null, permanent: false },
    ]);
  });

  it('should fail with BAD_RESPONSE when the error is not the proxy envelope', async () => {
    const fetchImage = createImageFetcher({
      fetch: async () => new Response('<html>oops</html>', { status: 500 }),
    });

    expect(await failureOf(fetchImage('t', IMAGE_URL))).toMatchObject({
      code: 'BAD_RESPONSE',
      status: 500,
    });
  });
});
