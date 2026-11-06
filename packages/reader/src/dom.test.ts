import { Readability } from '@mozilla/readability';
import { DOMParser as LinkedomParser } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { parseHtmlPage, type HtmlParser } from './dom';
import { NO_BODY_HTML } from './fixtures/web.fixtures';

const URL_ = 'https://danluu.example.com/post/';
const linkedom = new LinkedomParser() as unknown as HtmlParser;

describe('parseHtmlPage', () => {
  it('should create a body when the parser omits it (linkedom without <body>)', () => {
    expect(linkedom.parseFromString(NO_BODY_HTML, 'text/html').documentElement.localName).not.toBe(
      'html',
    );

    const { doc } = parseHtmlPage(NO_BODY_HTML, URL_, linkedom);

    expect(doc.body.parentNode).toBe(doc.documentElement);
  });

  it('should let Readability extract the text of a page without <body>', () => {
    const { doc } = parseHtmlPage(NO_BODY_HTML, URL_, linkedom);

    const article = new Readability(doc).parse();

    expect(article?.textContent).toContain('Unique-word-zebra');
  });

  it('should never put a <base> in the document, which the app CSP blocks', () => {
    const { doc, baseUrl } = parseHtmlPage('<head><base href="/docs/"></head><p>x</p>', URL_);
    expect([baseUrl, doc.querySelectorAll('base').length, doc.baseURI]).toEqual([
      'https://danluu.example.com/docs/',
      0,
      'https://danluu.example.com/docs/',
    ]);
  });

  it('should let Readability resolve every kind of relative URL against the page', () => {
    const html = `<article><h1>T</h1><p>${'Words in a paragraph. '.repeat(30)}
      <a href="next/">a</a> <a href="/root">b</a> <a href="//cdn.example.net/c">c</a>
      <a href="#part">d</a> <a href="?q=1">e</a></p>
      <img src="img/one.png"><img data-src="/lazy.png" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></article>`;
    const { doc } = parseHtmlPage(html, URL_);

    const content = new Readability(doc).parse()?.content ?? '';
    const out = new DOMParser().parseFromString(content, 'text/html');

    expect(Array.from(out.querySelectorAll('a'), (a) => a.getAttribute('href'))).toEqual([
      'https://danluu.example.com/post/next/',
      'https://danluu.example.com/root',
      'https://cdn.example.net/c',
      'https://danluu.example.com/post/#part',
      'https://danluu.example.com/post/?q=1',
    ]);
    expect(Array.from(out.querySelectorAll('img'), (img) => img.getAttribute('src'))).toEqual([
      'https://danluu.example.com/post/img/one.png',
      'https://danluu.example.com/lazy.png',
    ]);
  });

  it('should keep the page base when it is http(s)', () => {
    const { baseUrl } = parseHtmlPage('<head><base href="/docs/"></head><p>x</p>', URL_);
    expect(baseUrl).toBe('https://danluu.example.com/docs/');
  });

  it('should ignore a javascript: base', () => {
    const { baseUrl } = parseHtmlPage('<head><base href="javascript:alert(1)"></head>', URL_);
    expect(baseUrl).toBe(URL_);
  });
});
