import { describe, expect, it } from 'vitest';
import { htmlToText, IMAGE_SOURCE_ATTRIBUTE, sanitizeHtml } from './sanitize';

const BASE = 'https://blog.example.com/posts/one';

function render(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = sanitizeHtml(html, BASE);
  return container;
}

describe('sanitizeHtml', () => {
  it('should remove scripts with their content', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)</script>', BASE);
    expect(out).toBe('<p>ok</p>');
  });

  it.each([
    '<img src=x onerror="alert(1)">',
    '<svg><animate onbegin="alert(1)"></animate></svg>',
    '<p onclick="alert(1)">x</p>',
    '<a href="#" onmouseover="alert(1)">x</a>',
    '<iframe src="https://evil.example.net"></iframe>',
    '<object data="x"></object><embed src="x">',
    '<form action="https://evil.example.net"><input name="a"></form>',
    '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
    '<style>body{display:none}</style><p style="color:red">x</p>',
    '<table background="https://tracker.example.net/bg.png"><tr><td>x</td></tr></table>',
  ])('should strip dangerous markup from %s', (html) => {
    const out = sanitizeHtml(html, BASE);
    expect(out).not.toMatch(
      /on\w+=|<script|<iframe|<object|<embed|<form|<svg|<math|<style|style=|background=|javascript:/i,
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
  ])('should drop the href %s', (href) => {
    const link = render(`<a href="${href}">x</a>`).querySelector('a');
    expect(link?.hasAttribute('href')).toBe(false);
  });

  it('should resolve relative links and open them safely in a new tab', () => {
    const link = render('<a href="../notes">notes</a>').querySelector('a');
    expect([
      link?.getAttribute('href'),
      link?.getAttribute('target'),
      link?.getAttribute('rel'),
    ]).toEqual(['https://blog.example.com/notes', '_blank', 'noopener noreferrer']);
  });

  it('should keep mailto links', () => {
    const link = render('<a href="mailto:someone@example.com">mail</a>').querySelector('a');
    expect(link?.getAttribute('href')).toBe('mailto:someone@example.com');
  });

  it('should keep images from loading and move their url to the marker attribute', () => {
    const image = render(
      '<img src="/img/a.png" srcset="b.png 2x" alt="A" width="10">',
    ).querySelector('img');
    expect({
      src: image?.getAttribute('src'),
      srcset: image?.getAttribute('srcset'),
      marker: image?.getAttribute(IMAGE_SOURCE_ATTRIBUTE),
      alt: image?.getAttribute('alt'),
      width: image?.getAttribute('width'),
    }).toEqual({
      src: null,
      srcset: null,
      marker: 'https://blog.example.com/img/a.png',
      alt: 'A',
      width: null,
    });
  });

  it('should not keep a marker for data: images nor accept one from the source', () => {
    const image = render(
      `<img src="data:image/png;base64,AAAA" ${IMAGE_SOURCE_ATTRIBUTE}="javascript:alert(1)">`,
    ).querySelector('img');
    expect(image?.hasAttribute(IMAGE_SOURCE_ATTRIBUTE)).toBe(false);
  });

  it.each([
    'http://127.0.0.1:8080/admin',
    'http://169.254.169.254/x.png',
    'http://localhost/a.png',
  ])('should not keep a marker for the internal-network image %s', (src) => {
    const image = render(`<img src="${src}" alt="A">`).querySelector('img');
    expect(image?.hasAttribute(IMAGE_SOURCE_ATTRIBUTE)).toBe(false);
  });

  it('should drop class, id and data attributes', () => {
    const out = sanitizeHtml('<p class="a" id="b" data-x="c" aria-label="d">x</p>', BASE);
    expect(out).toBe('<p>x</p>');
  });

  it('should remove html comments', () => {
    expect(sanitizeHtml('<!-- SC_OFF --><p>x</p><!-- SC_ON -->', BASE)).toBe('<p>x</p>');
  });
});

describe('htmlToText', () => {
  it('should put each block on its own line and collapse spaces', () => {
    expect(htmlToText('<h1>Title</h1><p>One   <b>two</b></p><ul><li>a</li><li>b</li></ul>')).toBe(
      'Title\nOne two\na\nb',
    );
  });
});
