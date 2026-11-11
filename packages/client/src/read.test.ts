import type { ExtractData, FetchedDocument } from '@stash/core/extract';
import { describe, expect, it } from 'vitest';
import { readExtract, readHtml, unreadableLink } from './read';
import { webPage } from './test/backend';

function doc(url: string, body: string, contentType = 'text/html'): FetchedDocument {
  return { url, contentType, body, truncated: false };
}

const POST_URL = 'https://www.reddit.com/r/example/comments/abc123/a_title/';
const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><title>A title : example</title><entry><author><name>/u/someone</name></author><content type="html">&lt;div class="md"&gt;&lt;p&gt;Body of the post.&lt;/p&gt;&lt;/div&gt;</content><id>t3_abc123</id><link href="${POST_URL}" /><title>A title</title></entry></feed>`;
const TWEET_URL = 'https://x.com/example/status/20';
const OEMBED = JSON.stringify({
  url: TWEET_URL,
  author_name: 'Example User',
  author_url: 'https://x.com/example',
  html: '<blockquote class="twitter-tweet"><p>just setting up my account</p>&mdash; Example User (@example) <a href="https://x.com/example/status/20">March 21, 2006</a></blockquote>',
});

describe('readExtract', () => {
  it('should read a web page into its preview and sanitized article', () => {
    const url = 'https://blog.example.com/post';
    const words = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(' ');
    const result = readExtract(
      webPage(url, 'Cómo ordenar la despensa', [words, `${words} final`, words]),
      url,
    );

    expect({
      source: result.source,
      title: result.preview?.title,
      kind: result.content?.kind,
      hasText: result.content?.text.includes('palabra39 final'),
      scriptFree: !result.content?.html?.includes('<script'),
    }).toEqual({
      source: 'web',
      title: 'Cómo ordenar la despensa',
      kind: 'article',
      hasText: true,
      scriptFree: true,
    });
  });

  it('should read a Reddit post from its feed', () => {
    const data: ExtractData = { kind: 'reddit', feed: doc(POST_URL, FEED, 'application/atom+xml') };

    const result = readExtract(data, POST_URL);

    expect({ kind: result.content?.kind, text: result.content?.text }).toEqual({
      kind: 'post',
      text: 'Body of the post.',
    });
  });

  it('should read a post on X from oEmbed, also without the page', () => {
    const data: ExtractData = {
      kind: 'x',
      oembed: doc(TWEET_URL, OEMBED, 'application/json'),
      page: null,
    };

    const result = readExtract(data, TWEET_URL);

    expect({
      kind: result.content?.kind,
      text: result.content?.text,
      author: result.preview?.author,
    }).toEqual({ kind: 'tweet', text: 'just setting up my account', author: 'Example User' });
  });

  it('should keep the bare link when Instagram does not serve the page', () => {
    const url = 'https://www.instagram.com/p/abc/';

    const result = readExtract({ kind: 'instagram', page: null }, url);

    expect({
      source: result.source,
      content: result.content,
      title: result.preview?.title,
    }).toEqual({ source: 'instagram', content: { kind: 'none', text: '' }, title: null });
  });

  it('should read the preview of an Instagram page', () => {
    const url = 'https://www.instagram.com/p/abc/';
    const html =
      '<html><head><meta property="og:title" content="Una foto"><meta property="og:description" content="Pie de foto"></head><body></body></html>';

    const result = readExtract({ kind: 'instagram', page: doc(url, html) }, url);

    expect({ title: result.preview?.title, kind: result.content?.kind }).toEqual({
      title: 'Una foto',
      kind: 'none',
    });
  });

  it('should degrade to the bare link when the data has the wrong shape', () => {
    const url = 'https://example.com/';
    const broken = { kind: 'web', page: { body: 42 } } as unknown as ExtractData;

    expect(readExtract(broken, url)).toEqual(unreadableLink(url));
  });
});

describe('readHtml', () => {
  it('should read the HTML of an open tab like a page from the proxy', () => {
    const url = 'https://blog.example.com/post';
    const data = webPage(url, 'La despensa', ['uno dos tres '.repeat(30)]);
    const html = data.kind === 'web' ? data.page.body : '';

    expect(readHtml(html, url)).toEqual(readExtract(data, url));
  });

  it('should degrade to the bare link when the HTML cannot be read', () => {
    const url = 'https://example.com/';

    expect(readHtml(42 as unknown as string, url)).toEqual(unreadableLink(url));
  });
});

describe('unreadableLink', () => {
  it('should keep an empty preview so the link is not read again', () => {
    expect(unreadableLink('https://example.com/a')).toEqual({
      source: 'web',
      preview: {
        title: null,
        description: null,
        siteName: null,
        author: null,
        imageUrl: null,
        publishedAt: null,
      },
      content: { kind: 'none', text: '' },
    });
  });
});
