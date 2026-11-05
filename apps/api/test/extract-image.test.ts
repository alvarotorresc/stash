import { describe, expect, it } from 'vitest';
import { endlessStream, fakeFetch, html, redirect } from './fake-fetch';
import { app, postJson } from './routes-helpers';

const IMAGE = 'https://scontent-mad1-1.cdninstagram.com/v/t51/photo.jpg?oh=abc&oe=6AF24E15';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);

function image(bytes: BodyInit, type: string, headers: Record<string, string> = {}): Response {
  return new Response(bytes, { headers: { 'Content-Type': type, ...headers } });
}

async function errorOf(res: Response): Promise<{ status: number; code: string }> {
  const body = (await res.json()) as { error: { code: string } };
  return { status: res.status, code: body.error.code };
}

describe('POST /api/extract/image', () => {
  it('should return the raw image bytes with their type', async () => {
    const { fetch, calls } = fakeFetch({ [IMAGE]: () => image(JPEG, 'image/jpeg') });

    const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-length')).toBe(String(JPEG.byteLength));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    expect(calls[0]?.init?.headers).toMatchObject({ Accept: expect.stringContaining('image/') });
  });

  it.each(['image/png', 'image/webp', 'image/gif', 'image/avif', 'IMAGE/JPEG; q=1'])(
    'should accept %s',
    async (type) => {
      const { fetch } = fakeFetch({ [IMAGE]: () => image(JPEG, type) });

      const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

      expect(res.status).toBe(200);
    },
  );

  it.each(['image/svg+xml', 'text/html', 'application/octet-stream', ''])(
    'should refuse the content type "%s"',
    async (type) => {
      const { fetch } = fakeFetch({ [IMAGE]: () => image('<svg onload="x()"/>', type) });

      const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

      expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
    },
  );

  it('should refuse an image over the size limit, even if it hides its length', async () => {
    const { stream, state } = endlessStream(4096);
    const { fetch } = fakeFetch({ [IMAGE]: () => image(stream, 'image/png') });

    const res = await app({ fetch, limits: { maxImageBytes: 10_000 } })(
      '/api/extract/image',
      postJson({ url: IMAGE }),
    );

    expect(await errorOf(res)).toEqual({ status: 413, code: 'TOO_LARGE' });
    expect(state.cancelled).toBe(true);
  });

  it('should refuse an image that declares a length over the limit', async () => {
    const { fetch } = fakeFetch({
      [IMAGE]: () => image(JPEG, 'image/jpeg', { 'Content-Length': '99999999' }),
    });

    const res = await app({ fetch, limits: { maxImageBytes: 1000 } })(
      '/api/extract/image',
      postJson({ url: IMAGE }),
    );

    expect(await errorOf(res)).toEqual({ status: 413, code: 'TOO_LARGE' });
  });

  it('should refuse a redirect to a private address', async () => {
    const { fetch, calls } = fakeFetch({ [IMAGE]: () => redirect('http://192.168.1.1/cam.jpg') });

    const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'URL_NOT_ALLOWED' });
    expect(calls).toHaveLength(1);
  });

  it('should answer 502 when the image is gone', async () => {
    const { fetch } = fakeFetch({ [IMAGE]: () => html('expired', { status: 403 }) });

    const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

    expect(await errorOf(res)).toEqual({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('should answer 401 without a session', async () => {
    const { fetch, calls } = fakeFetch({ [IMAGE]: () => image(JPEG, 'image/jpeg') });

    const res = await app({ fetch, resolveSession: async () => null })(
      '/api/extract/image',
      postJson({ url: IMAGE }),
    );

    expect(await errorOf(res)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });

  it('should answer 405 to GET', async () => {
    const res = await app({ fetch: fakeFetch({}).fetch })('/api/extract/image');

    expect(res.status).toBe(405);
  });
});
