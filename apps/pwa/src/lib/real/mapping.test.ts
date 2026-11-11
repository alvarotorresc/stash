import type { ItemView } from '@stash/core/sync';
import { describe, expect, it } from 'vitest';
import {
  formatPublished,
  originOf,
  renderableHtml,
  safeHref,
  toContent,
  toDetail,
  toFilters,
  toItem,
  toneOf,
} from './mapping';

function view(overrides: Partial<ItemView> = {}): ItemView {
  return {
    id: 'item-1',
    url: 'https://www.blog.example.com/despensa',
    source: 'web',
    preview: null,
    content: null,
    thumbnail: null,
    categoryId: null,
    tagIds: [],
    priority: null,
    status: 'pending',
    savedAt: 1,
    updatedAt: 1,
    statusChangedAt: null,
    title: 'https://www.blog.example.com/despensa',
    category: null,
    tags: [],
    queued: false,
    ...overrides,
  };
}

const preview = (fields: Partial<NonNullable<ItemView['preview']>> = {}) => ({
  title: null,
  description: null,
  siteName: null,
  author: null,
  imageUrl: null,
  publishedAt: null,
  ...fields,
});

describe('originOf', () => {
  it.each([
    ['web', 'https://www.blog.example.com/a', 'blog.example.com'],
    ['reddit', 'https://www.reddit.com/r/askspain/comments/abc/x/', 'r/askspain'],
    ['reddit', 'https://redd.it/abc', 'redd.it'],
    ['x', 'https://x.com/ana/status/1', '@ana'],
    ['x', 'https://x.com/i/web/status/1', 'x.com'],
    ['instagram', 'https://www.instagram.com/p/abc/', 'instagram.com'],
    ['tiktok', 'https://www.tiktok.com/@ana/video/1', '@ana'],
    ['tiktok', 'https://vm.tiktok.com/ZMabc/', 'vm.tiktok.com'],
    ['tiktok', 'https://www.tiktok.com/@/video/1', 'tiktok.com'],
  ] as const)('should name the origin of a %s link', (source, url, origin) => {
    expect(originOf({ source, url })).toBe(origin);
  });
});

describe('toItem', () => {
  it('should carry when the status last changed, null if it never did', () => {
    expect([
      toItem(view()).statusChangedAt,
      toItem(view({ status: 'read', statusChangedAt: 5000 })).statusChangedAt,
    ]).toEqual([null, 5000]);
  });

  it('should show the image when there is one and the tone when there is not', () => {
    expect([
      toItem(view(), 'blob:x').thumbnail.src,
      toItem(view()).thumbnail.src,
      toItem(view()).thumbnail.tone,
    ]).toEqual(['blob:x', undefined, toneOf('item-1')]);
  });
});

describe('safeHref', () => {
  it('should only let http(s) links become an href', () => {
    expect({
      web: safeHref('https://example.com/a'),
      script: safeHref('javascript:alert(1)'),
      broken: safeHref('not a url'),
      origin: originOf({ source: 'web', url: 'javascript:alert(1)' }),
      item: toItem(view({ url: 'javascript:alert(1)' })).url,
    }).toEqual({
      web: 'https://example.com/a',
      script: 'about:blank',
      broken: 'about:blank',
      origin: '',
      item: 'about:blank',
    });
  });
});

describe('toItem', () => {
  it('should resolve tags by name and keep the placeholder tone stable', () => {
    const item = toItem(
      view({
        tags: [
          { id: 't1', name: 'cena', createdAt: 0 },
          { id: 't2', name: 'otoño', createdAt: 0 },
        ],
        categoryId: 'c1',
        priority: 'high',
      }),
    );

    expect({
      tags: item.tags,
      categoryId: item.categoryId,
      priority: item.priority,
      tone: item.thumbnail.tone === toneOf('item-1'),
      src: item.thumbnail.src,
    }).toEqual({
      tags: ['cena', 'otoño'],
      categoryId: 'c1',
      priority: 'high',
      tone: true,
      src: undefined,
    });
  });

  it('should show a decrypted thumbnail by its blob URL', () => {
    expect(toItem(view(), 'blob:stash/1').thumbnail.src).toBe('blob:stash/1');
  });

  it('should give tones from 1 to 4', () => {
    const tones = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(toneOf));

    expect([...tones].every((tone) => tone >= 1 && tone <= 4)).toBe(true);
  });
});

describe('toContent', () => {
  it('should show nothing downloaded yet for a queued link', () => {
    expect(toContent(view({ queued: true }))).toEqual({ kind: 'none' });
  });

  it('should show the preview, not blocked, while the page is still being read', () => {
    expect(toContent(view({ preview: preview({ description: 'Resumen' }) }))).toEqual({
      kind: 'preview',
      description: 'Resumen',
      image: undefined,
      blocked: false,
    });
  });

  it('should say X blocked reading when its post gave no text', () => {
    const tweet = view({
      url: 'https://x.com/ana/status/1',
      source: 'x',
      preview: preview(),
      content: { kind: 'none', text: '' },
    });

    expect(toContent(tweet)).toMatchObject({ kind: 'preview', blocked: true });
  });

  it('should keep Instagram as a preview with its image', () => {
    const post = view({
      url: 'https://www.instagram.com/p/abc/',
      source: 'instagram',
      preview: preview({ description: 'Pie de foto' }),
      content: { kind: 'none', text: '' },
    });

    expect(toContent(post, 'blob:stash/img')).toEqual({
      kind: 'preview',
      description: 'Pie de foto',
      image: { src: 'blob:stash/img', alt: '' },
      blocked: false,
    });
  });

  it('should keep TikTok as a preview with the caption of the video', () => {
    const video = view({
      url: 'https://www.tiktok.com/@ana/video/1',
      source: 'tiktok',
      preview: preview({ description: 'Cómo ordenar la despensa #orden' }),
      content: { kind: 'none', text: '' },
    });

    expect(toContent(video)).toEqual({
      kind: 'preview',
      description: 'Cómo ordenar la despensa #orden',
      image: undefined,
      blocked: false,
    });
  });

  it('should show an article with its origin and reading time', () => {
    const words = Array.from({ length: 450 }, () => 'palabra').join(' ');
    const article = view({ content: { kind: 'article', html: `<p>${words}</p>`, text: words } });

    expect(toContent(article)).toMatchObject({
      kind: 'article',
      meta: 'blog.example.com · 2 min',
      html: `<p>${words}</p>`,
    });
  });

  it('should point links saved against the app origin back to the article', () => {
    const html = `<p><a href="${window.location.origin}/notas">notas</a></p>`;
    const article = view({ content: { kind: 'article', html, text: 'notas' } });

    expect(toContent(article)).toMatchObject({
      html: expect.stringContaining('href="https://www.blog.example.com/notas"'),
    });
  });

  it('should show a Reddit post with its author', () => {
    const post = view({
      url: 'https://www.reddit.com/r/askspain/comments/abc/x/',
      source: 'reddit',
      preview: preview({ author: '/u/carmen' }),
      content: { kind: 'post', html: '<p>Texto</p>', text: 'Texto' },
    });

    expect(toContent(post)).toEqual({
      kind: 'reddit',
      meta: 'r/askspain · /u/carmen',
      html: '<p>Texto</p>',
    });
  });

  it('should show a post on X with author, handle and date', () => {
    const tweet = view({
      url: 'https://x.com/ana/status/1',
      source: 'x',
      preview: preview({ author: 'Ana Ruiz', publishedAt: '2026-10-14' }),
      content: { kind: 'tweet', text: 'Hola' },
    });

    expect(toContent(tweet)).toEqual({
      kind: 'tweet',
      author: { name: 'Ana Ruiz', handle: '@ana' },
      html: '<p>Hola</p>',
      images: [],
      date: formatPublished('2026-10-14'),
    });
  });

  it('should keep the detail and the list copy together', () => {
    const detail = toDetail(view({ queued: true }));

    expect({ id: detail.id, content: detail.content }).toEqual({
      id: 'item-1',
      content: { kind: 'none' },
    });
  });
});

describe('renderableHtml', () => {
  it('should sanitize stored HTML again before it is shown', () => {
    const html = renderableHtml({
      html: '<p>Hola<img src="https://evil.example/x.png" onerror="alert(1)"></p><script>alert(2)</script>',
      text: 'Hola',
    });

    expect({
      script: html.includes('<script'),
      handler: html.includes('onerror'),
      remoteSrc: / src=/.test(html),
      text: html.includes('Hola'),
    }).toEqual({ script: false, handler: false, remoteSrc: false, text: true });
  });

  it('should escape text kept without HTML, one paragraph per line', () => {
    expect(renderableHtml({ text: 'Uno <script>alert(1)</script>\n\nDos & tres' })).toBe(
      '<p>Uno &lt;script&gt;alert(1)&lt;/script&gt;</p><p>Dos &amp; tres</p>',
    );
  });
});

describe('formatPublished', () => {
  it('should format dates and leave out what it cannot read', () => {
    expect({
      none: formatPublished(null),
      broken: formatPublished('ayer'),
      day: formatPublished('2026-10-14').includes('2026'),
      time: formatPublished('2026-10-14T18:02:00Z').includes(':'),
    }).toEqual({ none: '', broken: '', day: true, time: true });
  });
});

describe('toFilters', () => {
  it('should turn "none" into items without category', () => {
    expect(
      toFilters({ query: 'x', status: 'all', source: 'reddit', category: 'none', priority: 'low' }),
    ).toEqual({ query: 'x', status: 'all', source: 'reddit', categoryId: null, priority: 'low' });
  });
});
