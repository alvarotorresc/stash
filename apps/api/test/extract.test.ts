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

const TT_VIDEO = 'https://www.tiktok.com/@themuthership/video/7378294254344342827';
const TT_OEMBED = `https://www.tiktok.com/oembed?url=${encodeURIComponent(TT_VIDEO)}`;
// Recorded from tiktok.com: today the oEmbed answers an iframe and nothing else.
const TT_OEMBED_JSON =
  '{"version":"1.0","type":"video","width":"325","height":"578","html":"<iframe height=\\"578\\" width=\\"325\\" src=\\"https://www.tiktok.com/player/v1/7378294254344342827?embed_from=oembed\\"></iframe>","provider_url":"https://www.tiktok.com","provider_name":"TikTok","embed_product_id":"7378294254344342827","embed_type":"video"}';
const TT_PAGE_HTML =
  '<title>TikTok - Make Your Day</title><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">{}</script>';

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

  it('should answer 413 when the oembed is too large and the page fails', async () => {
    const { fetch } = fakeFetch({
      [X_OEMBED]: () => json('x'.repeat(2000)),
      [X_PAGE]: () => html('', { status: 403 }),
    });

    const res = await app({ fetch, limits: { maxJsonBytes: 1000 } })(
      '/api/extract',
      postJson({ url: X_POST }),
    );

    expect(await errorOf(res)).toEqual({ status: 413, code: 'TOO_LARGE' });
  });

  it('should treat a profile as a plain page', async () => {
    const { fetch } = fakeFetch({ 'https://x.com/jack': () => html('<title>jack</title>') });

    const data = await extractOk(fetch, 'https://x.com/jack');

    expect(data.kind).toBe('web');
  });
});

describe('POST /api/extract — x oEmbed redirect', () => {
  it('should follow the redirect of the oembed endpoint to publish.x.com', async () => {
    // Recorded: publish.twitter.com answers 301 to publish.x.com with the same query.
    const moved =
      'https://publish.x.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fjack%2Fstatus%2F20&omit_script=1&dnt=true';
    const { fetch } = fakeFetch({
      [X_OEMBED]: () => redirect(moved),
      [moved]: () => json(X_OEMBED_JSON),
      [X_PAGE]: () => html(X_PAGE_HTML),
    });

    const data = await extractOk(fetch, X_POST);

    expect(data.kind === 'x' && data.oembed?.body).toBe(X_OEMBED_JSON);
  });
});

describe('POST /api/extract — tiktok', () => {
  it('should return the official oembed and the video page', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => json(TT_OEMBED_JSON),
      [TT_VIDEO]: () => html(TT_PAGE_HTML),
    });

    const data = await extractOk(fetch, TT_VIDEO);

    expect(data).toEqual({
      kind: 'tiktok',
      oembed: {
        url: TT_OEMBED,
        contentType: 'application/json',
        body: TT_OEMBED_JSON,
        truncated: false,
      },
      page: { url: TT_VIDEO, contentType: 'text/html', body: TT_PAGE_HTML, truncated: false },
    });
  });

  it('should request the canonical video, without tracking parameters or a mobile host', async () => {
    const { fetch, calls } = fakeFetch({
      [TT_OEMBED]: () => json(TT_OEMBED_JSON),
      [TT_VIDEO]: () => html(TT_PAGE_HTML),
    });

    await extractOk(
      fetch,
      `https://m.tiktok.com/@themuthership/video/7378294254344342827?_r=1&u_code=abc&is_from_webapp=1#top`,
    );

    expect(calls.map((call) => call.url).sort()).toEqual([TT_OEMBED, TT_VIDEO].sort());
  });

  it('should keep the oembed when the page fails', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => json(TT_OEMBED_JSON),
      [TT_VIDEO]: () => html('', { status: 403 }),
    });

    const data = await extractOk(fetch, TT_VIDEO);

    expect(data.kind === 'tiktok' && [data.oembed?.body, data.page]).toEqual([
      TT_OEMBED_JSON,
      null,
    ]);
  });

  it('should keep the page when the oembed fails', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => json('{}', 400),
      [TT_VIDEO]: () => html(TT_PAGE_HTML),
    });

    const data = await extractOk(fetch, TT_VIDEO);

    expect(data.kind === 'tiktok' && [data.oembed, data.page?.body]).toEqual([null, TT_PAGE_HTML]);
  });

  it('should fail when both downloads fail', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => json('{}', 404),
      [TT_VIDEO]: () => html('', { status: 403 }),
    });

    const res = await app({ fetch })('/api/extract', postJson({ url: TT_VIDEO }));

    expect(await errorOf(res)).toEqual({ status: 502, code: 'UPSTREAM_ERROR' });
  });

  it('should answer 413 when the oembed is too large and the page fails', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => json('x'.repeat(2000)),
      [TT_VIDEO]: () => html('', { status: 403 }),
    });

    const res = await app({ fetch, limits: { maxJsonBytes: 1000 } })(
      '/api/extract',
      postJson({ url: TT_VIDEO }),
    );

    expect(await errorOf(res)).toEqual({ status: 413, code: 'TOO_LARGE' });
  });

  it('should refuse an oembed served as html', async () => {
    const { fetch } = fakeFetch({
      [TT_OEMBED]: () => html('<p>blocked</p>'),
      [TT_VIDEO]: () => html(TT_PAGE_HTML),
    });

    const data = await extractOk(fetch, TT_VIDEO);

    expect(data.kind === 'tiktok' && data.oembed).toBeNull();
  });

  it('should resolve a share link to the video without downloading the shared address', async () => {
    // Synthetic: no live share link was found; the redirect has the shape tiktok.com answers
    // (a video path with share parameters that identify who shared it).
    const share = 'https://vt.tiktok.com/ZSexample/';
    const shared = `${TT_VIDEO}?_r=1&u_code=abc123&share_item_id=7378294254344342827&utm_source=short_fallback`;
    const { fetch, calls } = fakeFetch({
      [share]: () => redirect(shared, 302),
      [TT_OEMBED]: () => json(TT_OEMBED_JSON),
      [TT_VIDEO]: () => html(TT_PAGE_HTML),
    });

    const data = await extractOk(fetch, share);

    expect(data.kind).toBe('tiktok');
    expect(calls.map((call) => call.url)).toEqual(
      expect.arrayContaining([share, TT_OEMBED, TT_VIDEO]),
    );
    expect(calls.map((call) => call.url)).not.toContain(shared);
    expect(JSON.stringify(calls.slice(1))).not.toContain('u_code');
  });

  it('should resolve a video with no account in the link', async () => {
    const noUser = 'https://www.tiktok.com/@/video/7604403945846426900';
    const oembed = `https://www.tiktok.com/oembed?url=${encodeURIComponent(noUser)}`;
    const share = 'https://vm.tiktok.com/ZMexample/';
    const { fetch } = fakeFetch({
      [share]: () => redirect(`${noUser}?_r=1&u_code=abc`, 302),
      [oembed]: () => json(TT_OEMBED_JSON),
      [noUser]: () => html(TT_PAGE_HTML),
    });

    expect((await extractOk(fetch, share)).kind).toBe('tiktok');
  });

  it('should keep the bare link when a share link no longer leads to a video', async () => {
    // Recorded: tiktok.com/t/<code> redirects to www and then to the home page when the link is
    // gone, or when tiktok.com does not serve it to the proxy.
    const share = 'https://tiktok.com/t/ZPexample/';
    const { fetch, calls } = fakeFetch({
      [share]: () => redirect('https://www.tiktok.com/t/ZPexample/', 301),
      'https://www.tiktok.com/t/ZPexample/': () => redirect('https://www.tiktok.com/?_r=1', 302),
      'https://www.tiktok.com/?_r=1': () => html('<title>TikTok - Make Your Day</title>'),
    });

    const data = await extractOk(fetch, share);

    expect(data).toEqual({ kind: 'tiktok', oembed: null, page: null });
    expect(calls).toHaveLength(3);
  });

  it('should still refuse a share link that redirects to a private address', async () => {
    const share = 'https://vm.tiktok.com/ZMexample/';
    const { fetch } = fakeFetch({ [share]: () => redirect('http://10.0.0.1/', 302) });

    const res = await app({ fetch })('/api/extract', postJson({ url: share }));

    expect(await errorOf(res)).toEqual({ status: 400, code: 'URL_NOT_ALLOWED' });
  });

  it('should not treat a share link that ends on another site as a video', async () => {
    const share = 'https://vm.tiktok.com/ZMexample/';
    const { fetch } = fakeFetch({
      [share]: () => redirect('https://evil.example.com/@a/video/1', 302),
      'https://evil.example.com/@a/video/1': () => html('<p>x</p>'),
    });

    const data = await extractOk(fetch, share);

    expect(data).toEqual({ kind: 'tiktok', oembed: null, page: null });
  });

  it('should treat a profile as a plain page', async () => {
    const profile = 'https://www.tiktok.com/@themuthership';
    const { fetch } = fakeFetch({ [profile]: () => html('<title>profile</title>') });

    const data = await extractOk(fetch, profile);

    expect(data.kind).toBe('web');
  });

  it.each([
    ['look-alike host', 'https://nottiktok.com/@a/video/1'],
    ['host that only contains tiktok.com', 'https://tiktok.com.evil.org/@a/video/1'],
  ])('should treat a %s as a plain page', async (_name, url) => {
    const { fetch } = fakeFetch({ [url]: () => html('<p>x</p>') });

    expect((await extractOk(fetch, url)).kind).toBe('web');
  });

  it('should only build upstream addresses from the account and the id of the link', async () => {
    const odd = 'https://www.tiktok.com/@a%2F..%2Fb/video/1';
    const { fetch } = fakeFetch({ [odd]: () => html('<p>x</p>') });

    expect((await extractOk(fetch, odd)).kind).toBe('web');
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

  it('should answer the json 500 envelope when the rate limiter throws', async () => {
    const { fetch, calls } = fakeFetch({ [ARTICLE]: () => html(ARTICLE_HTML) });
    const limit = vi.fn(async () => {
      throw new Error(`limiter down while handling ${ARTICLE}`);
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await app({ fetch, rateLimiter: { limit } })(
      '/api/extract',
      postJson({ url: ARTICLE }),
    );

    expect(await errorOf(res)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(calls).toHaveLength(0);
    expect(JSON.stringify(error.mock.calls)).not.toContain(ARTICLE);
    error.mockRestore();
  });

  it('should answer the json 500 envelope when resolving the session throws', async () => {
    const { fetch, calls } = fakeFetch({ [ARTICLE]: () => html(ARTICLE_HTML) });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await app({
      fetch,
      resolveSession: async () => {
        throw new Error('session store down');
      },
    })('/api/extract', postJson({ url: ARTICLE }));

    expect(await errorOf(res)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    expect(calls).toHaveLength(0);
    error.mockRestore();
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
