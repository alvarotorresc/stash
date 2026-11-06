import { describe, expect, it } from 'vitest';
import {
  buildContent,
  exceedsInputLimit,
  exceedsStructureLimits,
  headOf,
  MAX_CONTENT_HTML,
  MAX_CONTENT_TEXT,
  MAX_DEPTH,
  MAX_ELEMENTS,
  MAX_INPUT_BYTES,
} from './limits';

function nested(depth: number): Element {
  // Built from the leaf up: appending under a detached parent stays cheap at any depth.
  let node = document.createElement('div');
  for (let i = 0; i < depth; i++) {
    const parent = document.createElement('div');
    parent.append(node);
    node = parent;
  }
  return node;
}

function wide(count: number): Element {
  const root = document.createElement('div');
  for (let i = 1; i < count; i++) root.append(document.createElement('p'));
  return root;
}

describe('exceedsInputLimit', () => {
  it('should accept input up to the limit in UTF-8 bytes', () => {
    expect(exceedsInputLimit('a'.repeat(MAX_INPUT_BYTES))).toBe(false);
  });

  it('should reject input over the limit', () => {
    expect(exceedsInputLimit('a'.repeat(MAX_INPUT_BYTES + 1))).toBe(true);
  });

  it('should count multi-byte characters as UTF-8', () => {
    // 'é' is 1 UTF-16 unit but 2 UTF-8 bytes.
    expect(exceedsInputLimit('é'.repeat(MAX_INPUT_BYTES / 2 + 1))).toBe(true);
    expect(exceedsInputLimit('é'.repeat(MAX_INPUT_BYTES / 2))).toBe(false);
  });
});

describe('headOf', () => {
  it('should keep the start of the input within the limit without splitting a surrogate pair', () => {
    const head = headOf('😀'.repeat(MAX_INPUT_BYTES));
    expect(exceedsInputLimit(head)).toBe(false);
    expect(head.length).toBeGreaterThan(0);
    expect(() => encodeURIComponent(head)).not.toThrow();
  });
});

describe('exceedsStructureLimits', () => {
  it('should accept a tree at the depth limit', () => {
    expect(exceedsStructureLimits(nested(MAX_DEPTH))).toBe(false);
  });

  it('should reject a tree deeper than the limit', () => {
    expect(exceedsStructureLimits(nested(MAX_DEPTH + 1))).toBe(true);
  });

  it('should accept a tree with as many elements as the limit', () => {
    expect(exceedsStructureLimits(wide(MAX_ELEMENTS))).toBe(false);
  });

  it('should reject a tree with more elements than the limit', () => {
    expect(exceedsStructureLimits(wide(MAX_ELEMENTS + 1))).toBe(true);
  });

  it('should walk back up after a deep branch and keep counting siblings', () => {
    const root = nested(MAX_DEPTH - 1);
    const siblings = wide(MAX_ELEMENTS - MAX_DEPTH + 2);
    root.append(...Array.from(siblings.children));
    expect(exceedsStructureLimits(root)).toBe(true);
  });

  it('should stop at the first level past the limit on a very deep tree', () => {
    expect(exceedsStructureLimits(nested(500))).toBe(true);
  });
});

describe('buildContent', () => {
  it('should build the content of sanitized html', () => {
    expect(buildContent('<p>One</p><p>Two</p>', 'article')).toEqual({
      content: { kind: 'article', html: '<p>One</p><p>Two</p>', text: 'One\nTwo' },
      issues: [],
    });
  });

  it('should give no content for empty html', () => {
    expect(buildContent('', 'post')).toEqual({ content: { kind: 'none', text: '' }, issues: [] });
  });

  it('should drop html over the limit and cap the text', { timeout: 60_000 }, () => {
    const { content, issues } = buildContent(`<p>${'a '.repeat(MAX_CONTENT_HTML)}</p>`, 'article');
    expect([content.kind, content.html, content.text.length, issues]).toEqual([
      'article',
      undefined,
      MAX_CONTENT_TEXT,
      ['too_large'],
    ]);
  });

  it('should keep html under the limit and cap only the text', () => {
    const html = `<p>${'a '.repeat((MAX_CONTENT_TEXT * 3) / 4)}</p>`;
    const { content, issues } = buildContent(html, 'post');
    expect([content.html === html, content.text.length <= MAX_CONTENT_TEXT, issues]).toEqual([
      true,
      true,
      ['too_large'],
    ]);
  });
});
