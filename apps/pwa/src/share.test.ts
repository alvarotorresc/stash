import { describe, expect, it } from 'vitest';
import {
  extractSharedUrl,
  handleShareRequest,
  isShareRequest,
  readSharedParam,
  shareRedirect,
  toHttpUrl,
} from './share';

const ORIGIN = 'https://stash.alvarotc.com';

describe('extractSharedUrl', () => {
  it('should take the url field when it is valid', () => {
    expect(
      extractSharedUrl({ url: 'https://x.com/a/status/1', text: 'https://other.example' }),
    ).toBe('https://x.com/a/status/1');
  });

  it('should find the link inside text when url is empty', () => {
    expect(
      extractSharedUrl({
        url: '',
        text: 'Mira esto: https://www.reddit.com/r/Madrid/comments/1h2k/algo.',
      }),
    ).toBe('https://www.reddit.com/r/Madrid/comments/1h2k/algo');
  });

  it('should return null for text without a link', () => {
    expect(extractSharedUrl({ text: 'Una receta de calabaza' })).toBeNull();
    expect(extractSharedUrl({})).toBeNull();
  });

  it('should take the first of several links', () => {
    expect(
      extractSharedUrl({ text: 'https://uno.example/a y también https://dos.example/b' }),
    ).toBe('https://uno.example/a');
  });

  it('should keep a closing parenthesis that belongs to the link', () => {
    expect(
      extractSharedUrl({ text: 'Mira (https://es.wikipedia.org/wiki/Calabaza_(fruto)).' }),
    ).toBe('https://es.wikipedia.org/wiki/Calabaza_(fruto)');
    expect(extractSharedUrl({ text: '(ver https://ok.example/p)' })).toBe('https://ok.example/p');
  });

  it('should reject links that are not http or https', () => {
    expect(extractSharedUrl({ url: 'javascript:alert(1)' })).toBeNull();
    expect(extractSharedUrl({ url: 'file:///etc/passwd', text: 'data:text/html,hola' })).toBeNull();
  });

  it('should fall back to text when url is not http', () => {
    expect(extractSharedUrl({ url: 'intent://x', text: 'ver https://ok.example/p' })).toBe(
      'https://ok.example/p',
    );
  });
});

describe('toHttpUrl', () => {
  it('should reject credentials in the link and very long values', () => {
    expect(toHttpUrl('https://user:pass@example.com/')).toBeNull();
    expect(toHttpUrl(`https://example.com/${'a'.repeat(3000)}`)).toBeNull();
    expect(toHttpUrl('no es una url')).toBeNull();
  });
});

describe('handleShareRequest', () => {
  const post = (fields: Record<string, string>) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    return new Request(`${ORIGIN}/share`, { method: 'POST', body });
  };

  it('should answer 303 to the app with the shared link', async () => {
    const response = await handleShareRequest(
      post({ title: 'Receta', text: 'https://www.instagram.com/p/abc/' }),
      ORIGIN,
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('Location') ?? '');
    expect(location.origin).toBe(ORIGIN);
    expect(location.searchParams.get('share')).toBe('https://www.instagram.com/p/abc/');
  });

  it('should send to the start when nothing usable was shared', async () => {
    const response = await handleShareRequest(post({ url: 'javascript:alert(1)' }), ORIGIN);

    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(`${ORIGIN}/`);
  });

  it('should survive a body that is not a form', async () => {
    const response = await handleShareRequest(
      new Request(`${ORIGIN}/share`, { method: 'POST', body: 'nada' }),
      ORIGIN,
    );

    expect(response.headers.get('Location')).toBe(`${ORIGIN}/`);
  });
});

describe('isShareRequest', () => {
  it('should match only a POST to the share path of this origin', () => {
    expect(isShareRequest(new Request(`${ORIGIN}/share`, { method: 'POST' }), ORIGIN)).toBe(true);
    expect(isShareRequest(new Request(`${ORIGIN}/share`), ORIGIN)).toBe(false);
    expect(isShareRequest(new Request(`${ORIGIN}/other`, { method: 'POST' }), ORIGIN)).toBe(false);
    expect(
      isShareRequest(new Request('https://evil.example/share', { method: 'POST' }), ORIGIN),
    ).toBe(false);
  });
});

describe('readSharedParam', () => {
  it('should validate the link again in the app', () => {
    const search = new URL(shareRedirect('https://example.com/a?b=1', ORIGIN)).search;

    expect(readSharedParam(search)).toBe('https://example.com/a?b=1');
    expect(readSharedParam('?share=javascript%3Aalert(1)')).toBeNull();
    expect(readSharedParam('')).toBeNull();
  });
});
