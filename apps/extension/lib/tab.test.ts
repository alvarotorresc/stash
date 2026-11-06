import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_HTML_LENGTH,
  MAX_META_CONTENT,
  MAX_META_TAGS,
  MAX_TITLE,
  capturePage,
  readActiveTab,
  toCapturedPage,
  type TabApi,
} from './tab';

const ARTICLE = `
  <head>
    <title>Cómo organizar la despensa</title>
    <meta charset="utf-8">
    <meta name="description" content="Cinco pasos para no tirar comida.">
    <meta property="og:title" content="Organizar la despensa">
    <meta property="OG:Image" content="https://lacocinaordenada.es/despensa.jpg">
    <meta name="author" content="María">
    <meta name="empty">
  </head>
  <body><article><h1>Organizar la despensa</h1><p>Primero, vacíala entera.</p></article></body>`;

function loadFixture(head: string) {
  document.documentElement.innerHTML = head;
}

afterEach(() => {
  document.documentElement.innerHTML = '<head></head><body></body>';
});

describe('capturePage', () => {
  it('should read the title, the meta tags and the HTML of the open page', () => {
    loadFixture(ARTICLE);

    const capture = capturePage();

    expect(capture.url).toBe(location.href);
    expect(capture.title).toBe('Cómo organizar la despensa');
    expect(capture.meta).toEqual([
      { key: 'description', content: 'Cinco pasos para no tirar comida.' },
      { key: 'og:title', content: 'Organizar la despensa' },
      { key: 'og:image', content: 'https://lacocinaordenada.es/despensa.jpg' },
      { key: 'author', content: 'María' },
    ]);
    expect(capture.html).toContain('<p>Primero, vacíala entera.</p>');
  });

  it('should send only the meta tags of a page that is too large', () => {
    loadFixture(
      `<head><title>Grande</title><meta name="description" content="Larga"></head>` +
        `<body><p>${'a'.repeat(MAX_HTML_LENGTH)}</p></body>`,
    );

    const capture = capturePage();

    expect(capture.html).toBeNull();
    expect(capture.meta).toEqual([{ key: 'description', content: 'Larga' }]);
  });

  it('should cap the number and size of meta tags', () => {
    const tags = Array.from(
      { length: MAX_META_TAGS + 10 },
      (_, i) => `<meta name="k${i}" content="${'v'.repeat(MAX_META_CONTENT + 5)}">`,
    ).join('');
    loadFixture(`<head>${tags}</head><body></body>`);

    const { meta } = capturePage();

    expect(meta).toHaveLength(MAX_META_TAGS);
    expect(meta[0]!.content).toHaveLength(MAX_META_CONTENT);
  });

  it('should not use anything outside its own body, since it is injected as text', () => {
    // A function serialized with toString() loses its closure: rebuild it from its source.
    loadFixture(ARTICLE);
    const rebuilt = new Function(`return (${capturePage.toString()})();`) as typeof capturePage;

    expect(rebuilt()).toEqual(capturePage());
  });
});

describe('toCapturedPage', () => {
  const url = 'https://example.com/a';

  it('should keep the tab address and a valid capture of the same page', () => {
    const page = toCapturedPage(url, 'Tab', {
      url: 'https://example.com/a#section',
      title: '  Título  ',
      html: '<html></html>',
      meta: [{ key: 'Description', content: 'Hola' }],
    });

    expect(page).toEqual({
      url,
      title: 'Título',
      html: '<html></html>',
      meta: [{ key: 'description', content: 'Hola' }],
    });
  });

  it('should drop a capture of another address and fall back to the tab title', () => {
    const page = toCapturedPage(url, 'Tab', {
      url: 'https://evil.example/',
      title: 'Otra',
      html: '<html></html>',
      meta: [],
    });

    expect(page).toEqual({ url, title: 'Tab' });
  });

  it.each([null, undefined, 'html', 42, []])(
    'should save only the address and title when the capture is %j',
    (value) => {
      expect(toCapturedPage(url, 'Tab', value)).toEqual({ url, title: 'Tab' });
    },
  );

  it('should drop malformed fields and oversized values', () => {
    const page = toCapturedPage(url, '', {
      url,
      title: 42,
      html: 'a'.repeat(MAX_HTML_LENGTH + 1),
      meta: [
        null,
        'x',
        { key: '', content: 'a' },
        { key: 'k', content: 3 },
        { key: 'ok', content: 'v' },
      ],
    });

    expect(page).toEqual({ url, title: url, meta: [{ key: 'ok', content: 'v' }] });
  });

  it('should cap the title and the meta tags', () => {
    const page = toCapturedPage(url, 'Tab', {
      url,
      title: 't'.repeat(MAX_TITLE + 10),
      html: null,
      meta: Array.from({ length: MAX_META_TAGS + 3 }, () => ({
        key: 'k',
        content: 'v'.repeat(MAX_META_CONTENT + 3),
      })),
    });

    expect(page.title).toHaveLength(MAX_TITLE);
    expect(page.html).toBeUndefined();
    expect(page.meta).toHaveLength(MAX_META_TAGS);
    expect(page.meta![0]!.content).toHaveLength(MAX_META_CONTENT);
  });
});

describe('readActiveTab', () => {
  function fakeApi(
    tabs: { id?: number; url?: string; title?: string }[],
    executeScript: TabApi['scripting']['executeScript'] = () => Promise.resolve([]),
  ) {
    const query = vi.fn(() => Promise.resolve(tabs));
    const inject = vi.fn(executeScript);
    const api: TabApi = { tabs: { query }, scripting: { executeScript: inject } };
    return { api, query, inject };
  }

  it('should read the active tab with the injected function', async () => {
    const tab = { id: 7, url: 'https://example.com/a', title: 'Tab' };
    const { api, query, inject } = fakeApi([tab], () =>
      Promise.resolve([
        { result: { url: tab.url, title: 'Página', html: '<html></html>', meta: [] } },
      ]),
    );

    const page = await readActiveTab(api);

    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(inject).toHaveBeenCalledWith({ target: { tabId: 7 }, func: capturePage });
    expect(page).toEqual({ url: tab.url, title: 'Página', html: '<html></html>', meta: [] });
  });

  it('should return null when there is no tab or it is not a web page', async () => {
    await expect(readActiveTab(fakeApi([]).api)).resolves.toBeNull();
    const browserPage = fakeApi([{ id: 1, url: 'chrome://extensions', title: 'Ext' }]);
    await expect(readActiveTab(browserPage.api)).resolves.toBeNull();
    expect(browserPage.inject).not.toHaveBeenCalled();
    await expect(readActiveTab(fakeApi([{ id: 1 }]).api)).resolves.toBeNull();
  });

  it('should still save the address and title when the page cannot be read', async () => {
    const tab = { id: 7, url: 'https://chromewebstore.google.com/x', title: 'Store' };
    const { api } = fakeApi([tab], () => Promise.reject(new Error('Cannot access contents')));

    await expect(readActiveTab(api)).resolves.toEqual({ url: tab.url, title: 'Store' });
  });

  it('should not inject anything into a tab without an id', async () => {
    const { api, inject } = fakeApi([{ url: 'https://example.com/' }]);

    await expect(readActiveTab(api)).resolves.toEqual({
      url: 'https://example.com/',
      title: 'https://example.com/',
    });
    expect(inject).not.toHaveBeenCalled();
  });

  it('should handle an empty injection result', async () => {
    const { api } = fakeApi([{ id: 2, url: 'https://example.com/', title: 'T' }]);

    await expect(readActiveTab(api)).resolves.toEqual({ url: 'https://example.com/', title: 'T' });
  });
});
