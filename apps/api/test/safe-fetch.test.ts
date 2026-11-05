import { describe, expect, it } from 'vitest';
import {
  decodeText,
  guardedGet,
  mediaType,
  readBounded,
  resolveRedirects,
  UpstreamError,
  USER_AGENT,
  type Fetcher,
  type RequestContext,
} from '../src/extract/safe-fetch';
import { endlessStream, fakeFetch, hangingFetch, html, redirect } from './fake-fetch';

const START = new URL('https://blog.example.org/post');
const neverAborts = () => new AbortController().signal;

function ctx(fetch: Fetcher, overrides: Partial<RequestContext> = {}): RequestContext {
  return { fetch, signal: neverAborts(), maxRedirects: 3, ...overrides };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof UpstreamError) return error.code;
    throw error;
  }
  throw new Error('expected the promise to reject');
}

describe('guardedGet', () => {
  it('should send only an honest user agent and accept header, without following redirects', async () => {
    const { fetch, calls } = fakeFetch({ [START.href]: () => html('<p>ok</p>') });

    const { response, url } = await guardedGet(START, 'text/html', ctx(fetch));

    expect(response.status).toBe(200);
    expect(url.href).toBe(START.href);
    expect(calls).toHaveLength(1);
    const init = calls[0]?.init;
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('manual');
    expect(init?.cache).toBe('no-store');
    expect(init?.headers).toEqual({ 'User-Agent': USER_AGENT, Accept: 'text/html' });
    expect(USER_AGENT).toContain('StashPreview/');
    expect(USER_AGENT).toContain('; +https://stash.alvarotc.com/bot)');
    expect(USER_AGENT).not.toMatch(/Chrome|Safari|Firefox|Gecko/);
  });

  it('should follow absolute and relative redirects', async () => {
    const { fetch, calls } = fakeFetch({
      [START.href]: () => redirect('https://www.example.org/moved', 302),
      'https://www.example.org/moved': () => redirect('/final', 308),
      'https://www.example.org/final': () => html('<p>ok</p>'),
    });

    const { url } = await guardedGet(START, 'text/html', ctx(fetch));

    expect(url.href).toBe('https://www.example.org/final');
    expect(calls.map((call) => call.url)).toEqual([
      START.href,
      'https://www.example.org/moved',
      'https://www.example.org/final',
    ]);
  });

  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/',
    'http://[::1]/',
    'file:///etc/passwd',
  ])('should refuse a redirect to %s without requesting it', async (location) => {
    const { fetch, calls } = fakeFetch({ [START.href]: () => redirect(location) });

    expect(await codeOf(guardedGet(START, 'text/html', ctx(fetch)))).toBe('URL_NOT_ALLOWED');
    expect(calls).toHaveLength(1);
  });

  it('should refuse a start url that is not allowed', async () => {
    const { fetch, calls } = fakeFetch({});

    expect(await codeOf(guardedGet(new URL('http://10.0.0.1/'), 'text/html', ctx(fetch)))).toBe(
      'URL_NOT_ALLOWED',
    );
    expect(calls).toHaveLength(0);
  });

  it('should stop after the maximum number of redirects', async () => {
    const { fetch, calls } = fakeFetch({
      'https://blog.example.org/post': () => redirect('/a'),
      'https://blog.example.org/a': () => redirect('/b'),
      'https://blog.example.org/b': () => redirect('/c'),
      'https://blog.example.org/c': () => redirect('/d'),
    });

    expect(await codeOf(guardedGet(START, 'text/html', ctx(fetch)))).toBe('UPSTREAM_ERROR');
    expect(calls).toHaveLength(4);
  });

  it('should fail on a redirect without a usable location', async () => {
    const missing = fakeFetch({ [START.href]: () => new Response(null, { status: 302 }) });
    const broken = fakeFetch({ [START.href]: () => redirect('http://[::1') });

    expect(await codeOf(guardedGet(START, 'text/html', ctx(missing.fetch)))).toBe('UPSTREAM_ERROR');
    expect(await codeOf(guardedGet(START, 'text/html', ctx(broken.fetch)))).toBe('UPSTREAM_ERROR');
  });

  it('should fail on error statuses', async () => {
    const { fetch } = fakeFetch({ [START.href]: () => html('blocked', { status: 429 }) });

    expect(await codeOf(guardedGet(START, 'text/html', ctx(fetch)))).toBe('UPSTREAM_ERROR');
  });

  it('should hide network errors behind a generic code', async () => {
    const fetch = (async () => {
      throw new TypeError(`connection refused to ${START.href}`);
    }) as Fetcher;

    expect(await codeOf(guardedGet(START, 'text/html', ctx(fetch)))).toBe('UPSTREAM_ERROR');
  });

  it('should time out when the origin never answers', async () => {
    const signal = AbortSignal.timeout(20);

    expect(await codeOf(guardedGet(START, 'text/html', ctx(hangingFetch, { signal })))).toBe(
      'UPSTREAM_TIMEOUT',
    );
  });

  it('should time out when the origin ignores the abort signal', async () => {
    const ignoresAbort = (() => new Promise<Response>(() => undefined)) as Fetcher;

    expect(
      await codeOf(
        guardedGet(START, 'text/html', ctx(ignoresAbort, { signal: AbortSignal.timeout(20) })),
      ),
    ).toBe('UPSTREAM_TIMEOUT');
  });

  it('should not even start when the deadline has already passed', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetch } = fakeFetch({ [START.href]: () => html('<p>ok</p>') });

    expect(
      await codeOf(guardedGet(START, 'text/html', ctx(fetch, { signal: controller.signal }))),
    ).toBe('UPSTREAM_TIMEOUT');
  });
});

describe('runtime support', () => {
  it('should accept the no-store cache mode used for outbound requests', () => {
    const request = new Request('https://blog.example.org/', { cache: 'no-store' });

    expect(request.cache).toBe('no-store');
  });
});

describe('resolveRedirects', () => {
  const isFinal = (url: URL) => url.pathname === '/final';

  it('should stop at the target without requesting it', async () => {
    const { fetch, calls } = fakeFetch({ [START.href]: () => redirect('/final') });

    const url = await resolveRedirects(START, ctx(fetch), isFinal);

    expect(url.href).toBe('https://blog.example.org/final');
    expect(calls).toHaveLength(1);
  });

  it('should fail when the chain ends somewhere else', async () => {
    const { fetch } = fakeFetch({ [START.href]: () => html('<p>landing</p>') });

    expect(await codeOf(resolveRedirects(START, ctx(fetch), isFinal))).toBe('UPSTREAM_ERROR');
  });
});

describe('readBounded', () => {
  it('should read a body under the limit', async () => {
    const body = await readBounded(html('hello'), 100, 'truncate', neverAborts());

    expect(new TextDecoder().decode(body.bytes)).toBe('hello');
    expect(body.truncated).toBe(false);
  });

  it('should read an empty body', async () => {
    const body = await readBounded(new Response(null), 100, 'reject', neverAborts());

    expect(body.bytes.byteLength).toBe(0);
  });

  it('should truncate an endless body at the limit and cancel the stream', async () => {
    const { stream, state } = endlessStream(1000);

    const body = await readBounded(new Response(stream), 2500, 'truncate', neverAborts());

    expect(body.bytes.byteLength).toBe(2500);
    expect(body.truncated).toBe(true);
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(6);
  });

  it('should reject an endless body that lies about its length and cancel the stream', async () => {
    const { stream, state } = endlessStream(1000);
    const response = new Response(stream, { headers: { 'Content-Length': '10' } });

    expect(await codeOf(readBounded(response, 2500, 'reject', neverAborts()))).toBe('TOO_LARGE');
    expect(state.cancelled).toBe(true);
  });

  it('should reject early when the declared length is over the limit', async () => {
    const { stream, state } = endlessStream();
    const response = new Response(stream, { headers: { 'Content-Length': '999999' } });

    expect(await codeOf(readBounded(response, 1000, 'reject', neverAborts()))).toBe('TOO_LARGE');
    expect(state.pulled).toBeLessThanOrEqual(1);
  });

  it('should time out when the body stalls', async () => {
    let cancelled = false;
    const stalled = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });

    expect(
      await codeOf(readBounded(new Response(stalled), 1000, 'truncate', AbortSignal.timeout(20))),
    ).toBe('UPSTREAM_TIMEOUT');
    expect(cancelled).toBe(true);
  });

  it('should hide stream errors behind a generic code', async () => {
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('reset'));
      },
    });

    expect(await codeOf(readBounded(new Response(failing), 1000, 'truncate', neverAborts()))).toBe(
      'UPSTREAM_ERROR',
    );
  });
});

describe('mediaType', () => {
  it('should drop parameters and normalise case', () => {
    expect(mediaType('Text/HTML; charset=UTF-8')).toBe('text/html');
    expect(mediaType(null)).toBe('');
  });
});

describe('decodeText', () => {
  const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1

  it('should use the charset of the content type', () => {
    expect(decodeText(latin1, 'text/html; charset=iso-8859-1')).toBe('café');
  });

  it('should use the charset of an html meta tag', () => {
    const head = new TextEncoder().encode('<meta charset="windows-1252">');
    const bytes = new Uint8Array([...head, ...latin1]);

    expect(decodeText(bytes, 'text/html')).toBe('<meta charset="windows-1252">café');
  });

  it('should default to utf-8 and survive unknown labels', () => {
    const utf8 = new TextEncoder().encode('café');

    expect(decodeText(utf8, null)).toBe('café');
    expect(decodeText(utf8, 'text/html; charset=made-up')).toBe('café');
  });
});
