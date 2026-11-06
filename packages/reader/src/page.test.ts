import { describe, expect, it } from 'vitest';
import { ReaderInputError } from './errors';
import {
  ARTICLE_HTML,
  BASE_HTML,
  INSTAGRAM_HTML,
  META_ONLY_HTML,
  NO_BODY_HTML,
  X_PAGE_HTML,
} from './fixtures/web.fixtures';
import { parseDocument, parsePage } from './page';

const ARTICLE_URL = 'https://blog.example.com/posts/plain-text?utm_source=feed';

describe('parsePage', () => {
  describe('web article', () => {
    const result = parsePage(ARTICLE_HTML, ARTICLE_URL);

    it('should read the metadata', () => {
      expect({
        source: result.source,
        url: result.url,
        canonicalUrl: result.canonicalUrl,
        title: result.title,
        description: result.description,
        author: result.author,
        siteName: result.siteName,
        imageUrl: result.imageUrl,
        publishedAt: result.publishedAt,
        issues: result.issues,
      }).toEqual({
        source: 'web',
        url: ARTICLE_URL,
        canonicalUrl: 'https://blog.example.com/posts/plain-text',
        title: 'Why plain text wins',
        description: 'An essay about plain text.',
        author: 'Jane Writer',
        siteName: 'Example Blog',
        imageUrl: 'https://blog.example.com/images/cover.png',
        publishedAt: '2025-03-04T10:00:00.000Z',
        issues: [],
      });
    });

    it('should extract the article as sanitized html and text', () => {
      expect(result.content.kind).toBe('article');
      expect(result.content.text).toContain('Plain text tools age well');
    });

    it('should leave out navigation and footer', () => {
      expect(result.content.text).not.toMatch(/Copyright|About/);
    });

    it('should not keep scripts, handlers, iframes, inline styles or javascript: links', () => {
      expect(result.content.html).not.toMatch(
        /<script|onerror|onclick|<iframe|style=|javascript:|alert/i,
      );
    });

    it('should resolve relative links against the page, not the app origin', () => {
      expect(result.content.html).toContain(
        '<a href="https://blog.example.com/notes/unix" target="_blank" rel="noopener noreferrer">',
      );
    });

    it('should keep remote images from loading', () => {
      expect(result.content.html).not.toMatch(/\ssrc=|srcset=/);
      expect(result.content.html).toContain(
        'data-stash-src="https://tracker.example.net/pixel.png"',
      );
    });
  });

  it.each([
    ['<link rel="canonical" href="https://paypal.com/login">', 'https://blog.example.com/a'],
    ['<meta property="og:url" content="https://paypal.com/login">', 'https://blog.example.com/a'],
    ['<link rel="canonical" href="https://example.com/a?b">', 'https://example.com/a?b'],
  ])('should only trust a canonical url on the same site: %s', (head, expected) => {
    expect(
      parsePage(`<head>${head}</head><p>x</p>`, 'https://blog.example.com/a').canonicalUrl,
    ).toBe(expected);
  });

  it('should read a page without <body>', () => {
    const result = parsePage(NO_BODY_HTML, 'https://danluu.example.com/post/');
    expect([
      result.title,
      result.content.kind,
      result.content.text.includes('Unique-word-zebra'),
    ]).toEqual(['No body here', 'article', true]);
  });

  it('should resolve links against the page <base>', () => {
    const result = parsePage(BASE_HTML, 'https://www.example.org/start');
    expect(result.content.html).toContain('href="https://cdn.example.org/docs/guide.html"');
  });

  it('should degrade to a preview when there is no readable content', () => {
    const result = parsePage(META_ONLY_HTML, 'https://www.example.org/short');
    expect(result).toMatchObject({
      title: 'Short page',
      description: 'Only a description.',
      author: null,
      imageUrl: null,
      siteName: 'example.org',
      content: { kind: 'none', text: '' },
      issues: ['no_readable_content'],
    });
  });

  it('should give at least the url for empty html', () => {
    const result = parsePage('', 'https://www.example.org/empty');
    expect(result).toMatchObject({
      url: 'https://www.example.org/empty',
      canonicalUrl: 'https://www.example.org/empty',
      title: null,
      content: { kind: 'none', text: '' },
    });
  });

  it('should treat a Reddit page as a post', () => {
    const result = parsePage(ARTICLE_HTML, 'https://www.reddit.com/r/example/comments/abc123/');
    expect([result.source, result.content.kind]).toEqual(['reddit', 'post']);
  });

  it('should only give a preview for Instagram', () => {
    const result = parsePage(INSTAGRAM_HTML, 'https://www.instagram.com/p/abc/');
    expect(result).toMatchObject({
      source: 'instagram',
      title: 'Example Account on Instagram',
      description: 'A caption about the sky.',
      imageUrl: 'https://scontent.example.com/v/photo.jpg?oh=1&oe=2',
      siteName: 'Instagram',
      content: { kind: 'none', text: '' },
      issues: [],
    });
  });

  it('should read an X page through its metadata', () => {
    const result = parsePage(X_PAGE_HTML, 'https://x.com/example/status/20');
    expect(result).toMatchObject({
      source: 'x',
      imageUrl: 'https://pbs.example.com/media/photo.jpg',
      content: { kind: 'tweet', text: 'just setting up my account' },
    });
  });

  it('should throw ReaderInputError for an invalid url', () => {
    expect(() => parsePage(ARTICLE_HTML, 'javascript:alert(1)')).toThrow(ReaderInputError);
  });

  it('should throw ReaderInputError when html is not a string', () => {
    expect(() => parsePage(null as unknown as string, ARTICLE_URL)).toThrow(ReaderInputError);
  });
});

describe('parseDocument', () => {
  it('should parse a live document without modifying it', () => {
    const doc = new DOMParser().parseFromString(ARTICLE_HTML, 'text/html');
    const before = doc.documentElement.outerHTML;

    const result = parseDocument(doc, ARTICLE_URL);

    expect([result.content.kind, doc.documentElement.outerHTML === before]).toEqual([
      'article',
      true,
    ]);
  });

  it('should parse a document whose body was removed', () => {
    const doc = document.implementation.createHTMLDocument('');
    doc.body.remove();
    for (let i = 0; i < 3; i++) {
      const paragraph = doc.createElement('p');
      paragraph.textContent =
        'A paragraph with enough words to be read, about plain text and tools. '.repeat(5);
      doc.documentElement.append(paragraph);
    }

    const result = parseDocument(doc, 'https://danluu.example.com/post/');

    expect(result.content.text).toContain('A paragraph with enough words');
  });

  it('should throw ReaderInputError when doc is not a Document', () => {
    expect(() => parseDocument({} as Document, ARTICLE_URL)).toThrow(ReaderInputError);
  });
});
