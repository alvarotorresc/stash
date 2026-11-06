import { describe, expect, it } from 'vitest';
import { XSS_VECTORS } from './fixtures/xss.fixtures';
import { IMAGE_SOURCE_ATTRIBUTE, sanitizeHtml, sanitizeStoredHtml } from './sanitize';

const BASE = 'https://blog.example.com/posts/one';

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'svg',
  'math',
  'style',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'template',
  'noscript',
  'video',
  'audio',
  'source',
  'picture',
  'portal',
  'fencedframe',
  'dialog',
  'details',
  'marquee',
  'keygen',
  'isindex',
  'body',
  'html',
  'head',
  'title',
  'xmp',
  'noembed',
  'noframes',
]);
const LOADING_ATTRIBUTES = new Set([
  'src',
  'srcset',
  'srcdoc',
  'poster',
  'background',
  'formaction',
  'action',
  'data',
  'ping',
  'xlink:href',
  'style',
]);

/** Inserts sanitized HTML into the live document, as the app would, and lists what is unsafe. */
function problems(html: string): string[] {
  const found: string[] = [];
  const container = document.createElement('div');
  container.innerHTML = html;
  for (const element of Array.from(container.querySelectorAll('*'))) {
    const tag = element.localName;
    if (FORBIDDEN_TAGS.has(tag)) found.push(`tag ${tag}`);
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') found.push(`namespace ${tag}`);
    for (const { name, value } of Array.from(element.attributes)) {
      if (name.startsWith('on')) found.push(`handler ${name}`);
      if (name === 'id' || name === 'name' || name === 'class') found.push(`clobbering ${name}`);
      if (LOADING_ATTRIBUTES.has(name)) found.push(`${name} on ${tag}`);
      if (name.startsWith('data-') && name !== IMAGE_SOURCE_ATTRIBUTE) found.push(`data ${name}`);
      if (name === IMAGE_SOURCE_ATTRIBUTE && (tag !== 'img' || !/^https?:\/\//.test(value))) {
        found.push(`marker ${value} on ${tag}`);
      }
      if (name === 'href' && (tag !== 'a' || !/^(https?:\/\/|mailto:)/i.test(value))) {
        found.push(`href ${value} on ${tag}`);
      }
    }
    if (tag === 'a' && element.hasAttribute('href')) {
      if (element.getAttribute('target') !== '_blank') found.push('target');
      if (element.getAttribute('rel') !== 'noopener noreferrer') found.push('rel');
    }
  }
  return found;
}

describe('sanitizeHtml and sanitizeStoredHtml against known vectors', () => {
  it.each(XSS_VECTORS)('%s', (vector) => {
    const extracted = sanitizeHtml(vector, BASE);
    const stored = sanitizeStoredHtml(vector);
    expect([problems(extracted), problems(stored)]).toEqual([[], []]);
    // Idempotent, and a no-op on what extraction already returned.
    expect(sanitizeStoredHtml(stored)).toBe(stored);
    expect(sanitizeStoredHtml(extracted)).toBe(extracted);
  });

  it('should leave nothing that runs after inserting every output', async () => {
    const flag = window as unknown as { pwned?: number };
    flag.pwned = 0;
    const host = document.createElement('div');
    document.body.append(host);
    for (const vector of XSS_VECTORS) {
      const payload = vector.replaceAll('alert(1)', 'window.pwned=1');
      host.innerHTML = sanitizeStoredHtml(sanitizeHtml(payload, BASE));
      host.innerHTML = sanitizeStoredHtml(payload);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    host.remove();
    expect(flag.pwned).toBe(0);
  });
});

describe('sanitizeStoredHtml', () => {
  it('should keep the image marker of extracted html', () => {
    const extracted = sanitizeHtml('<p>x</p><img src="/a.png" alt="A">', BASE);
    expect(sanitizeStoredHtml(extracted)).toBe(
      '<p>x</p><img alt="A" data-stash-src="https://blog.example.com/a.png">',
    );
  });

  it('should keep links of extracted html', () => {
    const extracted = sanitizeHtml(
      '<a href="/notes">n</a><a href="mailto:a@example.com">m</a>',
      BASE,
    );
    expect(sanitizeStoredHtml(extracted)).toBe(extracted);
  });

  it.each([
    ['<img data-stash-src="javascript:alert(1)">', '<img>'],
    ['<img data-stash-src="http://127.0.0.1/a.png">', '<img>'],
    ['<img data-stash-src="/relative.png">', '<img>'],
    ['<img src="https://cdn.example.com/a.png">', '<img>'],
    ['<p data-stash-src="https://cdn.example.com/a.png">x</p>', '<p>x</p>'],
    ['<a href="/relative">x</a>', '<a>x</a>'],
    [
      '<img data-stash-src="https://Cdn.Example.com/a b.png">',
      '<img data-stash-src="https://cdn.example.com/a%20b.png">',
    ],
  ])('should clean %s', (html, expected) => {
    expect(sanitizeStoredHtml(html)).toBe(expected);
  });

  describe('with the page url', () => {
    const app = window.location.origin;

    it('should move links and images saved against the app origin back to the page', () => {
      const saved =
        `<a href="${app}/en-US/docs/CSP?x=1#top">a</a>` +
        `<img data-stash-src="${app}/img/a.png">` +
        '<a href="https://other.example.org/b">b</a><a href="mailto:a@example.com">m</a>';

      expect(sanitizeStoredHtml(saved, BASE)).toBe(
        '<a href="https://blog.example.com/en-US/docs/CSP?x=1#top" target="_blank" rel="noopener noreferrer">a</a>' +
          '<img data-stash-src="https://blog.example.com/img/a.png">' +
          '<a href="https://other.example.org/b" target="_blank" rel="noopener noreferrer">b</a>' +
          '<a href="mailto:a@example.com" target="_blank" rel="noopener noreferrer">m</a>',
      );
    });

    it('should be idempotent', () => {
      const once = sanitizeStoredHtml(`<a href="${app}/a">a</a>`, BASE);
      expect(sanitizeStoredHtml(once, BASE)).toBe(once);
    });

    it.each(['javascript:alert(1)', 'not a url'])(
      'should only repair against an http(s) page url, not %s',
      (pageUrl) => {
        expect(sanitizeStoredHtml(`<img data-stash-src="${app}/a.png">`, pageUrl)).toBe(
          sanitizeStoredHtml(`<img data-stash-src="${app}/a.png">`),
        );
      },
    );

    it('should still drop images that land on a non-public host', () => {
      expect(
        sanitizeStoredHtml(`<img data-stash-src="${app}/a.png">`, 'http://127.0.0.1/post'),
      ).toBe('<img>');
    });
  });

  it('should not let stored mode leak into extraction', () => {
    sanitizeStoredHtml('<img data-stash-src="https://cdn.example.com/a.png">');
    expect(sanitizeHtml('<img data-stash-src="https://cdn.example.com/a.png">', BASE)).toBe(
      '<img>',
    );
  });
});
