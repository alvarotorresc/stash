import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_URL, isOwnExtensionPage, parseMessage } from './messages';

describe('parseMessage', () => {
  it('should accept a save-link message with a web address', () => {
    expect(parseMessage({ type: 'save-link', url: 'https://example.com/a?b=1' })).toEqual({
      type: 'save-link',
      url: 'https://example.com/a?b=1',
    });
  });

  it('should normalize the address and drop extra keys', () => {
    expect(
      parseMessage({ type: 'save-link', url: 'HTTP://Example.com', __proto__: {}, extra: 1 }),
    ).toEqual({ type: 'save-link', url: 'http://example.com/' });
  });

  it.each([
    null,
    undefined,
    'save-link',
    42,
    [],
    ['save-link', 'https://example.com'],
    {},
    { type: 'save-link' },
    { type: 'delete-all', url: 'https://example.com' },
    { type: 'SAVE-LINK', url: 'https://example.com' },
    { type: 'save-link', url: 42 },
    { type: 'save-link', url: { href: 'https://example.com' } },
    { type: 'save-link', url: 'javascript:alert(1)' },
    { type: 'save-link', url: 'data:text/html,<script>alert(1)</script>' },
    { type: 'save-link', url: 'chrome://settings' },
    { type: 'save-link', url: 'not a url' },
  ])('should drop %j', (value) => {
    expect(parseMessage(value)).toBeNull();
  });

  it('should drop addresses longer than the limit', () => {
    const url = `https://example.com/${'a'.repeat(MAX_MESSAGE_URL)}`;
    expect(parseMessage({ type: 'save-link', url })).toBeNull();
  });
});

describe('isOwnExtensionPage', () => {
  const id = 'abcdefghijklmnop';
  const base = `chrome-extension://${id}/`;

  it('should accept the popup of this extension', () => {
    expect(isOwnExtensionPage({ id, url: `${base}popup.html` }, id, base)).toBe(true);
  });

  it('should reject other extensions', () => {
    expect(
      isOwnExtensionPage({ id: 'other', url: 'chrome-extension://other/popup.html' }, id, base),
    ).toBe(false);
  });

  it('should reject scripts running in a tab, even with this extension id', () => {
    expect(isOwnExtensionPage({ id, url: 'https://evil.example/', tab: { id: 3 } }, id, base)).toBe(
      false,
    );
    expect(isOwnExtensionPage({ id, url: `${base}popup.html`, tab: { id: 3 } }, id, base)).toBe(
      false,
    );
  });

  it('should reject senders without an address or outside the extension', () => {
    expect(isOwnExtensionPage({ id }, id, base)).toBe(false);
    expect(isOwnExtensionPage({ id, url: 'https://example.com/' }, id, base)).toBe(false);
    expect(isOwnExtensionPage({ id, url: `chrome-extension://${id}x/popup.html` }, id, base)).toBe(
      false,
    );
  });

  it('should reject everything when the extension id or base is unknown', () => {
    expect(isOwnExtensionPage({ id: '', url: `${base}popup.html` }, '', base)).toBe(false);
    expect(isOwnExtensionPage({ id, url: `${base}popup.html` }, id, '')).toBe(false);
    expect(
      isOwnExtensionPage({ id, url: `${base}popup.html` }, id, `chrome-extension://${id}`),
    ).toBe(false);
  });
});
