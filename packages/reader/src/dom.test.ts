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

  it('should set a single base with the page url', () => {
    const { doc, baseUrl } = parseHtmlPage('<p>x</p>', URL_);
    expect([baseUrl, doc.querySelectorAll('base').length, doc.baseURI]).toEqual([URL_, 1, URL_]);
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
