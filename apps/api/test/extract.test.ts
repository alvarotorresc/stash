import type { ExtractData } from '@stash/core/extract';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExtractRoutes, DEFAULT_LIMITS } from '../src/extract/routes';
import type { Fetcher } from '../src/extract/safe-fetch';
import { endlessStream, fakeFetch, hangingFetch, html, redirect } from './fake-fetch';
import { app, postJson, SESSION } from './routes-helpers';

const ARTICLE = 'https://blog.example.org/2026/11/post';
const ARTICLE_HTML = `<!doctype html><html><head>
<meta property="og:title" content="A post">
<meta property="og:description" content="About things">
<meta property="og:image" content="https://blog.example.org/cover.jpg">
</head><body><article><p>Body</p></article></body></html>`;

const REDDIT_POST = 'https://www.reddit.com/r/AskHistorians/comments/yopql1/some_title/?share=1';
const REDDIT_FEED = 'https://www.reddit.com/r/AskHistorians/comments/yopql1/.rss';
const REDDIT_RSS = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><author><name>/u/someone</name></author><title>Question</title>
<content type="html">&lt;p&gt;Full text&lt;/p&gt;</content></entry>
<entry><title>A comment</title></entry></feed>`;

const X_POST = 'https://x.com/jack/status/20';
const X_OEMBED =
  'https://publish.twitter.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fjack%2Fstatus%2F20&omit_script=1&dnt=true';
const X_PAGE = 'https://x.com/jack/status/20';
const X_OEMBED_JSON = JSON.stringify({
  author_name: 'jack',
  author_url: 'https://twitter.com/jack',
  html: '<blockquote><p>just setting up my twttr</p></blockquote>',
});
const X_PAGE_HTML = '<meta property="og:description" content="just setting up my twttr">';

const IG_POST = 'https://www.instagram.com/p/BsOGulcndj-/';

function json(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

function atom(body: string): Response {
  return new Response(body, { headers: { 'Content-Type': 'application/atom+xml; charset=UTF-8' } });
}

async function extractOk(fetch: Fetcher, url: string): Promise<ExtractData> {
  const res = await app({ fetch })('/api/extract', postJson({ url }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { data: ExtractData };
  return body.data;
}

async function errorOf(res: Response): Promise<{ status: number; code: string }> {
  const body = (await res.json()) as { error: { code: string } };
  return { status: res.status, code: body.error.code };
}

describe('POST /api/extract — web pages', () => {
  it('should return the raw html of an article in the data envelope', async () => {
    const { fetch } = fakeFetch({ [ARTICLE]: () => html(ARTICLE_HTML) });

    const res = await app({ fetch })('/api/extract', postJson({ url: ARTICLE }));

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      data: {
        kind: 'web',
        page: { url: ARTICLE, contentType: 'text/html', body: ARTICLE_HTML, truncated: false },
      },
    });
  });

  it('should report the final url after redirects', async () => {
    const { fetch } = fakeFetch({
      'http://blog.example.org/p': () => redirect(ARTICLE),
      [ARTICLE]: () => html(ARTICLE_HTML),
    });

    const data = await extractOk(fetch, 'http://blog.example.org/p');

    expect(data.kind === 'web' && data.page.url).toBe(ARTICLE);
  });

  it('should cut a huge page at the size limit and flag it', async () => {
    const { stream, state } = endlessStream(4096);
    const { fetch } = fakeFetch({
      [ARTICLE]: () => new Response(stream, { headers: { 'Content-Type': 'text/html' } }),
    });

    const res = await app({ fetch, limits: { maxDocumentBytes: 10_000 } })(
      '/api/extract',
      postJson({ url: ARTICLE }),
    );
    const { data } = (await res.json()) as { data: ExtractData };

    expect(data.kind).toBe('web');
    if (data.kind !== 'web') return;
    expect(data.page.body).toHaveLength(10_000);
    expect(data.page.truncated).toBe(true);
    expect(state.cancelled).toBe(true);
  });

  it('should refuse content that is not html', async () => {
    const { fetch } = fakeFetch({
      [ARTICLE]: () => new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }),
    });

    const res = await app({ fetch })('/api/extract', postJson({ url: ARTICLE }));

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('should answer 502 when the site fails', async () => {
    const { fetch } = fakeFetch({ [ARTICLE]: () => html('nope', { status: 403 }) });

    const res = await app({ fetch })('/api/extract', postJson({ url: ARTICLE }));

    expect(await errorOf(res)).toEqual({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('should answer 504 when the site takes too long', async () => {
    const res = await app({ fetch: hangingFetch, limits: { timeoutMs: 20 } })(
      '/api/extract',
      postJson({ url: ARTICLE }),
    );

    expect(await errorOf(res)).toEqual({ status: 504, code: 'UPSTREAM_TIMEOUT' });
  });

  it('should refuse a redirect to a private address', async () => {
    const { fetch, calls } = fakeFetch({
      [ARTICLE]: () => redirect('http://169.254.169.254/latest/meta-data/'),
    });

    const res = await app({ fetch })('/api/extract', postJson({ url: ARTICLE }));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'URL_NOT_ALLOWED' });
    expect(calls.map((call) => call.url)).toEqual([ARTICLE]);
  });
});

describe('POST /api/extract — reddit', () => {
  it('should download the feed of the post, without the query and on www', async () => {
    const { fetch, calls } = fakeFetch({ [REDDIT_FEED]: () => atom(REDDIT_RSS) });

    const data = await extractOk(fetch, REDDIT_POST);

    expect(data).toEqual({
      kind: 'reddit',
      feed: {
        url: REDDIT_FEED,
        contentType: 'application/atom+xml',
        body: REDDIT_RSS,
        truncated: false,
      },
    });
    expect(calls[0]?.init?.headers).toMatchObject({ Accept: expect.stringContaining('atom') });
  });

  it.each([
    'https://old.reddit.com/r/AskHistorians/comments/yopql1/',
    'https://reddit.com/r/AskHistorians/comments/YOPQL1',
    'https://new.reddit.com/r/AskHistorians/comments/yopql1/some_title/comment/abc/',
  ])('should map %s to the same feed', async (url) => {
    const { fetch } = fakeFetch({ [REDDIT_FEED]: () => atom(REDDIT_RSS) });

    const data = await extractOk(fetch, url);

    expect(data.kind).toBe('reddit');
  });

  it('should resolve a mobile share link without downloading the post page', async () => {
    const share = 'https://www.reddit.com/r/AskHistorians/s/AbCdEf123';
    const { fetch, calls } = fakeFetch({
      [share]: () => redirect('https://www.reddit.com/r/AskHistorians/comments/yopql1/t/?x=1'),
      [REDDIT_FEED]: () => atom(REDDIT_RSS),
    });

    const data = await extractOk(fetch, share);

    expect(data.kind).toBe('reddit');
    expect(calls.map((call) => call.url)).toEqual([share, REDDIT_FEED]);
  });

  it('should resolve a redd.it short link', async () => {
    const { fetch } = fakeFetch({
      'https://redd.it/yopql1': () => redirect('https://www.reddit.com/comments/yopql1/t/'),
      'https://www.reddit.com/comments/yopql1/.rss': () => atom(REDDIT_RSS),
    });

    const data = await extractOk(fetch, 'https://redd.it/yopql1');

    expect(data.kind).toBe('reddit');
  });

  it('should fail when a share link does not lead to a post', async () => {
    const share = 'https://www.reddit.com/r/AskHistorians/s/AbCdEf123';
    const { fetch } = fakeFetch({ [share]: () => html('<p>login</p>') });

    const res = await app({ fetch })('/api/extract', postJson({ url: share }));

    expect(await errorOf(res)).toEqual({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('should treat a subreddit page as a plain page', async () => {
    const sub = 'https://www.reddit.com/r/AskHistorians/';
    const { fetch } = fakeFetch({ [sub]: () => html('<title>r/AskHistorians</title>') });

    const data = await extractOk(fetch, sub);

    expect(data.kind).toBe('web');
  });

  it('should refuse a feed served as html', async () => {
    const { fetch } = fakeFetch({ [REDDIT_FEED]: () => html('<p>blocked</p>') });

    const res = await app({ fetch })('/api/extract', postJson({ url: REDDIT_POST }));

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });
});

describe('POST /api/extract — x', () => {
  it('should return the official oembed and the post page', async () => {
    const { fetch, calls } = fakeFetch({
      [X_OEMBED]: () => json(X_OEMBED_JSON),
      [X_PAGE]: () => html(X_PAGE_HTML),
    });

    const data = await extractOk(fetch, 'https://twitter.com/jack/status/20?s=20');

    expect(data).toEqual({
      kind: 'x',
      oembed: {
        url: X_OEMBED,
        contentType: 'application/json',
        body: X_OEMBED_JSON,
        truncated: false,
      },
      page: { url: X_PAGE, contentType: 'text/html', body: X_PAGE_HTML, truncated: false },
    });
    const hosts = calls.map((call) => new URL(call.url).hostname).sort();
    expect(hosts).toEqual(['publish.twitter.com', 'x.com']);
  });

  it('should keep the oembed when the page fails', async () => {
    const { fetch } = fakeFetch({
      [X_OEMBED]: () => json(X_OEMBED_JSON),
      [X_PAGE]: () => html('', { status: 403 }),
    });

    const data = await extractOk(fetch, X_POST);

    expect(data.kind === 'x' && data.oembed?.body).toBe(X_OEMBED_JSON);
    expect(data.kind === 'x' && data.page).toBeNull();
  });

  it('should keep the page when the oembed fails or is too large', async () => {
    const { fetch } = fakeFetch({
      [X_OEMBED]: () => json('x'.repeat(2000)),
      [X_PAGE]: () => html(X_PAGE_HTML),
    });

    const res = await app({ fetch, limits: { maxJsonBytes: 1000 } })(
      '/api/extract',
      postJson({ url: X_POST }),
    );
    const { data } = (await res.json()) as { data: ExtractData };

    expect(data.kind === 'x' && data.oembed).toBeNull();
    expect(data.kind === 'x' && data.page?.body).toBe(X_PAGE_HTML);
  });

  it('should fail when both downloads fail', async () => {
    const { fetch } = fakeFetch({
      [X_OEMBED]: () => json('{}', 404),
      [X_PAGE]: () => html('', { status: 403 }),
    });

    const res = await app({ fetch })('/api/extract', postJson({ url: X_POST }));

    expect(await errorOf(res)).toEqual({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('should treat a profile as a plain page', async () => {
    const { fetch } = fakeFetch({ 'https://x.com/jack': () => html('<title>jack</title>') });

    const data = await extractOk(fetch, 'https://x.com/jack');

    expect(data.kind).toBe('web');
  });
});

describe('POST /api/extract — instagram', () => {
  it('should return the post page when instagram serves it', async () => {
    const page = '<meta property="og:image" content="https://scontent.cdninstagram.com/a.jpg">';
    const { fetch } = fakeFetch({ [IG_POST]: () => html(page) });

    const data = await extractOk(fetch, IG_POST);

    expect(data.kind === 'instagram' && data.page?.body).toBe(page);
  });

  it('should answer without a page when instagram blocks the request', async () => {
    const { fetch } = fakeFetch({ [IG_POST]: () => html('', { status: 429 }) });

    expect(await extractOk(fetch, IG_POST)).toEqual({ kind: 'instagram', page: null });
  });

  it('should answer without a page when instagram redirects to the login', async () => {
    const login = 'https://www.instagram.com/accounts/login/?next=%2Fp%2FBsOGulcndj-%2F';
    const { fetch } = fakeFetch({
      [IG_POST]: () => redirect(login, 302),
      [login]: () => html('<title>Login</title>'),
    });

    expect(await extractOk(fetch, IG_POST)).toEqual({ kind: 'instagram', page: null });
  });

  it('should never request the embed page', async () => {
    const { fetch, calls } = fakeFetch({ [IG_POST]: () => html('<title>post</title>') });

    await extractOk(fetch, IG_POST);

    expect(calls.every((call) => !call.url.includes('/embed'))).toBe(true);
  });

  it('should still refuse a redirect to a private address', async () => {
    const { fetch } = fakeFetch({ [IG_POST]: () => redirect('http://10.0.0.1/') });

    const res = await app({ fetch })('/api/extract', postJson({ url: IG_POST }));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'URL_NOT_ALLOWED' });
  });
});

describe('POST /api/extract — request handling', () => {
  const noFetch = fakeFetch({}).fetch;

  it('should answer 401 without a session and never fetch', async () => {
    const { fetch, calls } = fakeFetch({ [ARTICLE]: () => html(ARTICLE_HTML) });

    const res = await app({ fetch, resolveSession: async () => null })(
      '/api/extract',
      postJson({ url: ARTICLE }),
    );

    expect(await errorOf(res)).toEqual({ status: 401, code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });

  it.each(['GET', 'PUT', 'DELETE'])('should answer 405 to %s', async (method) => {
    const res = await app({ fetch: noFetch })('/api/extract', { method });

    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('should answer 429 when the account is over its rate limit', async () => {
    const limit = vi.fn(async () => ({ success: false }));

    const res = await app({ fetch: noFetch, rateLimiter: { limit } })(
      '/api/extract',
      postJson({ url: ARTICLE }),
    );

    expect(await errorOf(res)).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(limit).toHaveBeenCalledWith({ key: SESSION.accountId });
  });

  it('should refuse a body that is not json', async () => {
    const res = await app({ fetch: noFetch })('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: ARTICLE,
    });

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('should refuse the url in the query string', async () => {
    const res = await app({ fetch: noFetch })(
      `/api/extract?url=${encodeURIComponent(ARTICLE)}`,
      postJson({ url: ARTICLE }),
    );

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it.each([
    ['malformed json', '{"url":'],
    ['a json array', '[]'],
    ['json null', 'null'],
    ['no url', '{}'],
    ['a non-string url', '{"url":42}'],
    ['an empty url', '{"url":""}'],
    ['a url that is too long', JSON.stringify({ url: `${ARTICLE}?${'a'.repeat(2100)}` })],
    ['a body over the size limit', JSON.stringify({ url: ARTICLE, pad: 'a'.repeat(5000) })],
  ])('should answer 400 to %s', async (_label, body) => {
    const res = await app({ fetch: noFetch })('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body,
    });

    expect(await errorOf(res)).toEqual({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it.each([
    'not a url',
    'file:///etc/passwd',
    'http://localhost:8787/api/health',
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[fd12::1]/',
    'https://blog.example.org:8443/',
  ])('should refuse the target %s without fetching', async (url) => {
    const { fetch, calls } = fakeFetch({});

    const res = await app({ fetch })('/api/extract', postJson({ url }));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'URL_NOT_ALLOWED' });
    expect(calls).toHaveLength(0);
  });

  it('should answer 500 without details on an unexpected failure', async () => {
    const broken = (async () => null) as unknown as Fetcher;
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await app({ fetch: broken })('/api/extract', postJson({ url: ARTICLE }));

    expect(await errorOf(res)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(consoleError).toHaveBeenCalledWith('extract: unexpected error', 'TypeError');
    consoleError.mockRestore();
  });

  it('should not handle other paths', async () => {
    const routes = createExtractRoutes({
      fetch: noFetch,
      resolveSession: async () => null,
      rateLimiter: { limit: async () => ({ success: true }) },
      limits: DEFAULT_LIMITS,
    });

    expect(await routes(new Request('https://stash.test/api/other'), '/api/other')).toBeNull();
  });
});

describe('POST /api/extract — privacy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should never write the url to the console, on success or on failure', async () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
    const spies = methods.map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { fetch } = fakeFetch({
      [ARTICLE]: () => html(ARTICLE_HTML),
      'https://blog.example.org/fails': () => html('', { status: 500 }),
      'https://blog.example.org/private': () => redirect('http://10.0.0.1/'),
    });
    const throwing = (async () => {
      throw new Error(`boom ${ARTICLE}`);
    }) as Fetcher;
    const broken = (async () => null) as unknown as Fetcher;
    const request = app({ fetch });

    await request('/api/extract', postJson({ url: ARTICLE }));
    await request('/api/extract', postJson({ url: 'https://blog.example.org/fails' }));
    await request('/api/extract', postJson({ url: 'https://blog.example.org/private' }));
    await request('/api/extract', postJson({ url: 'not a url' }));
    await app({ fetch: throwing })('/api/extract', postJson({ url: ARTICLE }));
    await app({ fetch: broken })('/api/extract', postJson({ url: ARTICLE }));

    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('blog.example.org');
    expect(logged).not.toContain('not a url');
    expect(logged).not.toContain('10.0.0.1');
  });

  it('should not echo the url in error responses', async () => {
    const throwing = (async () => {
      throw new Error(`boom ${ARTICLE}`);
    }) as Fetcher;

    const res = await app({ fetch: throwing })('/api/extract', postJson({ url: ARTICLE }));

    expect(await res.text()).not.toContain('blog.example.org');
  });

  it('should not forward client headers or cookies upstream', async () => {
    const { fetch, calls } = fakeFetch({ [ARTICLE]: () => html(ARTICLE_HTML) });

    await app({ fetch })('/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret-token',
        Cookie: 'session=secret',
        'X-Forwarded-For': '203.0.113.9',
      },
      body: JSON.stringify({ url: ARTICLE }),
    });

    const sent = calls[0]?.init?.headers as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(['Accept', 'User-Agent']);
    expect(JSON.stringify(calls[0]?.init)).not.toContain('secret');
  });
});
