import { describe, expect, it } from 'vitest';
import { endlessStream, fakeFetch, html, redirect } from './fake-fetch';
import { app, postJson } from './routes-helpers';

const IMAGE = 'https://scontent-mad1-1.cdninstagram.com/v/t51/photo.jpg?oh=abc&oe=6AF24E15';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const GIF87 = bytesOf('GIF87a\x01\x00\x01\x00');
const GIF89 = bytesOf('GIF89a\x01\x00\x01\x00');
const WEBP = bytesOf('RIFF\x24\x00\x00\x00WEBPVP8 ');
/** ftyp box of 28 bytes: major brand `mif1`, compatible brands `mif1`, `avif`, `miaf`. */
const AVIF = bytesOf('\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1avifmiaf');
const AVIS = bytesOf('\x00\x00\x00\x14ftypavis\x00\x00\x00\x00');

function bytesOf(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

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

  it.each([
    ['image/png', PNG],
    ['image/webp', WEBP],
    ['image/gif', GIF87],
    ['image/gif', GIF89],
    ['image/avif', AVIF],
    ['image/avif', AVIS],
    ['IMAGE/JPEG; q=1', JPEG],
  ])('should accept %s whose bytes match the type', async (type, bytes) => {
    const { fetch } = fakeFetch({ [IMAGE]: () => image(bytes, type) });

    const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it.each([
    ['png bytes declared as jpeg', 'image/jpeg', PNG],
    ['jpeg bytes declared as png', 'image/png', JPEG],
    ['html declared as png', 'image/png', bytesOf('<!doctype html><script>x()</script>')],
    ['svg declared as gif', 'image/gif', bytesOf('<svg onload="x()"/>')],
    ['a riff that is not webp', 'image/webp', bytesOf('RIFF\x24\x00\x00\x00WAVEfmt ')],
    [
      'an ftyp box without an avif brand',
      'image/avif',
      bytesOf('\x00\x00\x00\x14ftypisom\x00\x00\x00\x00'),
    ],
    ['a truncated png signature', 'image/png', PNG.slice(0, 4)],
    ['an empty body', 'image/jpeg', new Uint8Array()],
  ])('should refuse %s', async (_label, type, bytes) => {
    const { fetch } = fakeFetch({ [IMAGE]: () => image(bytes, type) });

    const res = await app({ fetch })('/api/extract/image', postJson({ url: IMAGE }));

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

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
