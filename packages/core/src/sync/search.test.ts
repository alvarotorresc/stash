import { describe, expect, it } from 'vitest';
import type { Priority } from '../priority';
import { detectSource, httpUrl, itemTitle, tagKey, tagName } from './model';
import { byPriority, foldText, isUnclassified, searchItems, type ItemView } from './search';

let counter = 0;

function view(overrides: Partial<ItemView> = {}): ItemView {
  counter += 1;
  return {
    id: `item-${counter}`,
    url: `https://example.com/${counter}`,
    source: 'web',
    preview: null,
    content: null,
    thumbnail: null,
    categoryId: null,
    tagIds: [],
    priority: null,
    status: 'pending',
    savedAt: counter,
    updatedAt: counter,
    statusChangedAt: null,
    title: `https://example.com/${counter}`,
    category: null,
    tags: [],
    queued: false,
    ...overrides,
  };
}

describe('isUnclassified', () => {
  const category = { id: 'c1', name: 'Cocina', order: 0, createdAt: 0, updatedAt: 0 };

  it.each<[string, Partial<ItemView>, boolean]>([
    ['neither', {}, true],
    ['only a priority', { priority: 'high' }, true],
    ['only a category', { category, categoryId: 'c1' }, true],
    ['both', { priority: 'low', category, categoryId: 'c1' }, false],
  ])('should tell whether an item with %s is still to classify', (_name, overrides, expected) => {
    expect(isUnclassified(view(overrides))).toBe(expected);
  });
});

describe('searchItems', () => {
  const category = { id: 'c1', name: 'Cocina', order: 0, createdAt: 0, updatedAt: 0 };
  const tag = { id: 't1', name: 'cena', createdAt: 0 };
  const soup = view({
    title: 'Sopa de miso',
    category,
    categoryId: 'c1',
    tags: [tag],
    tagIds: ['t1'],
    priority: 'high',
    source: 'reddit',
    content: {
      kind: 'post',
      text: 'Una receta larga. '.repeat(10) + 'Lleva una canción de fondo y mucho jengibre fresco.',
    },
  });
  const read = view({ title: 'Artículo leído', status: 'read', source: 'x' });
  const plain = view({ title: 'Otra cosa' });
  const items = [soup, read, plain];

  it('should return everything, newest first, without filters', () => {
    expect(searchItems(items).map(({ item }) => item.id)).toEqual([plain.id, read.id, soup.id]);
  });

  it.each<[string, Parameters<typeof searchItems>[1], string[]]>([
    ['status', { status: 'read' }, [read.id]],
    ['source', { source: 'reddit' }, [soup.id]],
    ['category', { categoryId: 'c1' }, [soup.id]],
    ['unclassified', { categoryId: null }, [plain.id, read.id]],
    ['priority', { priority: 'high' }, [soup.id]],
    ['no priority', { priority: null }, [plain.id, read.id]],
    ['tag', { tagId: 't1' }, [soup.id]],
    ['still to classify', { unclassified: true }, [plain.id, read.id]],
    [
      'all',
      { status: 'all', source: 'all', categoryId: 'all', priority: 'all', tagId: 'all' },
      [plain.id, read.id, soup.id],
    ],
  ])('should filter by %s', (_name, filters, expected) => {
    expect(searchItems(items, filters).map(({ item }) => item.id)).toEqual(expected);
  });

  it('should match ignoring case and accents', () => {
    expect(searchItems(items, { query: 'ARTICULO LEIDO' }).map(({ item }) => item.id)).toEqual([
      read.id,
    ]);
  });

  it('should find a word only in the content and give a snippet around it', () => {
    const [result] = searchItems(items, { query: 'cancion' });

    expect({
      id: result?.item.id,
      snippet: result?.snippet?.includes('canción de fondo'),
      ellipsis: result?.snippet?.startsWith('…'),
    }).toEqual({ id: soup.id, snippet: true, ellipsis: true });
  });

  it('should not give a snippet when the title matches', () => {
    expect(searchItems(items, { query: 'sopa' })[0]?.snippet).toBeUndefined();
  });

  it('should need every word of the query', () => {
    expect(searchItems(items, { query: 'sopa jengibre' }).length).toBe(1);
    expect(searchItems(items, { query: 'sopa pizza' }).length).toBe(0);
  });

  it('should find tag names', () => {
    expect(searchItems(items, { query: 'cena' }).map(({ item }) => item.id)).toEqual([soup.id]);
  });
});

describe('byPriority', () => {
  it('should order high, medium, low, none, and newest first within each', () => {
    const make = (priority: Priority | null, savedAt: number) => view({ priority, savedAt });
    const list = [
      make(null, 9),
      make('low', 1),
      make('high', 1),
      make('high', 5),
      make('medium', 2),
    ];

    expect(list.sort(byPriority).map(({ priority, savedAt }) => `${priority}:${savedAt}`)).toEqual([
      'high:5',
      'high:1',
      'medium:2',
      'low:1',
      'null:9',
    ]);
  });
});

describe('model helpers', () => {
  it('should fold text', () => {
    expect(foldText('Ñandú CANCIÓN')).toBe('nandu cancion');
  });

  it.each([
    ['https://x.com/a/status/1', 'x'],
    ['https://twitter.com/a', 'x'],
    ['https://www.reddit.com/r/a', 'reddit'],
    ['https://old.reddit.com/r/a', 'reddit'],
    ['https://www.instagram.com/p/1', 'instagram'],
    ['https://www.tiktok.com/@a/video/1', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
    ['https://nottiktok.com/@a/video/1', 'web'],
    ['https://blog.example.com', 'web'],
  ])('should detect the source of %s', (url, source) => {
    expect(detectSource(url)).toBe(source);
  });

  it('should normalise URLs and refuse other schemes or very long ones', () => {
    expect(httpUrl('  https://Example.com/a b ')).toBe('https://example.com/a%20b');
    expect(() => httpUrl('ftp://example.com')).toThrow();
    expect(() => httpUrl('not a url')).toThrow();
    expect(() => httpUrl(`https://example.com/${'a'.repeat(2100)}`)).toThrow();
  });

  it('should clean tag names and compare them ignoring case', () => {
    expect([tagName('  Mi   etiqueta '), tagKey('MI Etiqueta')]).toEqual([
      'Mi etiqueta',
      'mi etiqueta',
    ]);
  });

  it('should fall back to the URL as title', () => {
    expect([
      itemTitle({ url: 'https://a.test', preview: null }),
      itemTitle({
        url: 'https://a.test',
        preview: {
          title: '  ',
          description: null,
          siteName: null,
          author: null,
          imageUrl: null,
          publishedAt: null,
        },
      }),
    ]).toEqual(['https://a.test', 'https://a.test']);
  });
});
