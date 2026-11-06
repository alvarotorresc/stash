import { describe, expect, it } from 'vitest';
import { encryptRecord, type DataKey } from '../crypto/records';
import { decodeRecord, encodeRecord, fitItem, openRecord, sealRecord } from './codec';
import { SyncError } from './errors';
import type { Item, RecordValue } from './model';

async function dataKey(): Promise<DataKey> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return key as DataKey;
}

const ID = '7f1f0c4e-2b9a-4c1e-9d3a-5b6c7d8e9f00';

function item(overrides: Partial<Item> = {}): Item {
  return {
    id: ID,
    url: 'https://example.com/a',
    source: 'web',
    preview: {
      title: 'Title',
      description: null,
      siteName: null,
      author: null,
      imageUrl: null,
      publishedAt: null,
    },
    content: { kind: 'article', html: '<p>Hi</p>', text: 'Hi' },
    thumbnail: { type: 'image/webp', bytes: new Uint8Array([1, 2, 3, 250]) },
    categoryId: null,
    tagIds: ['t1'],
    priority: 'medium',
    status: 'pending',
    savedAt: 1,
    updatedAt: 2,
    statusChangedAt: null,
    ...overrides,
  };
}

function rawRecord(json: unknown, tail = new Uint8Array()): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(json));
  const bytes = new Uint8Array(5 + body.length + tail.length);
  bytes[0] = 1;
  new DataView(bytes.buffer).setUint32(1, body.length);
  bytes.set(body, 5);
  bytes.set(tail, 5 + body.length);
  return bytes;
}

describe('codec', () => {
  it.each<RecordValue>([
    { kind: 'item', value: item() },
    {
      kind: 'item',
      value: item({ thumbnail: null, preview: null, content: null, priority: null }),
    },
    { kind: 'category', value: { id: ID, name: 'Cocina', order: 2, createdAt: 1, updatedAt: 3 } },
    { kind: 'tag', value: { id: ID, name: 'cena', createdAt: 1 } },
  ])('should encrypt and decrypt a $kind record unchanged', async (record) => {
    const key = await dataKey();

    const blob = await sealRecord(key, record);

    expect(await openRecord(key, ID, record.kind, blob)).toEqual(record);
  });

  it('should keep the thumbnail as raw bytes after the JSON', () => {
    const bytes = encodeRecord({ kind: 'item', value: item() });

    expect([...bytes.slice(-4)]).toEqual([1, 2, 3, 250]);
  });

  it('should reject a blob opened as another kind', async () => {
    const key = await dataKey();
    const blob = await sealRecord(key, { kind: 'tag', value: { id: ID, name: 'x', createdAt: 1 } });

    await expect(openRecord(key, ID, 'item', blob)).rejects.toThrow('Kind does not match');
  });

  it('should reject a blob opened under another id', async () => {
    const key = await dataKey();
    const blob = await sealRecord(key, { kind: 'item', value: item() });

    await expect(openRecord(key, 'other-id', 'item', blob)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
  });

  it.each([
    ['an unknown format byte', new Uint8Array([2, 0, 0, 0, 0])],
    ['a header longer than the bytes', new Uint8Array([1, 0, 0, 1, 0])],
    ['an unknown schema version', rawRecord({ v: 2, kind: 'tag', name: 'x', createdAt: 1 })],
    ['an unknown kind', rawRecord({ v: 1, kind: 'note' })],
    ['a missing field', rawRecord({ v: 1, kind: 'tag', createdAt: 1 })],
    ['a wrong status', rawRecord({ ...item(), v: 1, kind: 'item', status: 'archived' })],
    ['a wrong priority', rawRecord({ ...item(), v: 1, kind: 'item', priority: 'urgent' })],
    ['tag ids that are not a list', rawRecord({ ...item(), v: 1, kind: 'item', tagIds: 'a' })],
    ['a preview that is not an object', rawRecord({ ...item(), v: 1, kind: 'item', preview: 3 })],
    ['a non-finite date', rawRecord({ v: 1, kind: 'tag', name: 'x', createdAt: 'yesterday' })],
    [
      'an unknown thumbnail type',
      rawRecord({ ...item(), v: 1, kind: 'item', thumbnailType: 'image/svg+xml' }),
    ],
  ])('should reject a record with %s', (_name, bytes) => {
    expect(() => decodeRecord(ID, bytes)).toThrow();
  });

  it('should read an encrypted record that is not in the expected format as an error', async () => {
    const key = await dataKey();
    const blob = await encryptRecord(key, ID, new TextEncoder().encode('{"title":"x"}'));

    await expect(openRecord(key, ID, 'item', blob)).rejects.toThrow();
  });
});

describe('fitItem', () => {
  const size = (value: Item) => encodeRecord({ kind: 'item', value }).length;

  it('should leave an item that fits untouched', () => {
    const value = item();

    expect(fitItem(value)).toBe(value);
  });

  it('should drop the HTML first and keep the text', () => {
    const value = item({ content: { kind: 'article', html: 'x'.repeat(5000), text: 'body' } });

    const fitted = fitItem(value, size(value) - 100);

    expect(fitted.content).toEqual({ kind: 'article', text: 'body' });
  });

  it('should then cut the text to fit', () => {
    const value = item({ content: { kind: 'article', text: 'ñ'.repeat(5000) } });
    const max = size(value) - 3000;

    const fitted = fitItem(value, max);

    expect({
      fits: size(fitted) <= max,
      cut: (fitted.content?.text.length ?? 0) < 5000,
      thumbnail: fitted.thumbnail !== null,
    }).toEqual({ fits: true, cut: true, thumbnail: true });
  });

  it('should not leave half a surrogate pair when cutting', () => {
    const value = item({ content: { kind: 'article', text: '😀'.repeat(1000) }, thumbnail: null });

    const fitted = fitItem(value, size(value) - 1001);

    expect(/[\uD800-\uDBFF]$/.test(fitted.content?.text ?? '')).toBe(false);
  });

  it('should finally drop the thumbnail', () => {
    const value = item({
      content: null,
      thumbnail: { type: 'image/jpeg', bytes: new Uint8Array(4000) },
    });

    expect(fitItem(value, size(value) - 1000).thumbnail).toBeNull();
  });

  it('should fail with TOO_LARGE when nothing else can go', () => {
    const value = item({ content: null, thumbnail: null });

    expect(() => fitItem(value, 10)).toThrow(SyncError);
  });
});
