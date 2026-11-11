import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThumbnailUrls } from './thumbnail-urls';

type View = Parameters<ReturnType<typeof createThumbnailUrls>['of']>[0];

const view = (id: string, bytes?: Uint8Array): View =>
  ({ id, thumbnail: bytes ? { type: 'image/webp', bytes } : null }) as View;

let counter = 0;
const created: string[] = [];
const revoked: string[] = [];

vi.stubGlobal('URL', {
  createObjectURL: () => {
    const url = `blob:test/${++counter}`;
    created.push(url);
    return url;
  },
  revokeObjectURL: (url: string) => revoked.push(url),
});

afterEach(() => {
  counter = 0;
  created.length = 0;
  revoked.length = 0;
});

describe('createThumbnailUrls', () => {
  it('should give no URL to an item without thumbnail', () => {
    expect(createThumbnailUrls().of(view('a'))).toBeUndefined();
  });

  it('should make the object URL once while the bytes are the same', () => {
    const urls = createThumbnailUrls();
    const bytes = new Uint8Array([1]);

    expect([urls.of(view('a', bytes)), urls.of(view('a', bytes))]).toEqual([
      'blob:test/1',
      'blob:test/1',
    ]);
    expect(created).toHaveLength(1);
  });

  it('should revoke the old URL when the image changes or goes away', () => {
    const urls = createThumbnailUrls();
    const first = urls.of(view('a', new Uint8Array([1])));
    const second = urls.of(view('a', new Uint8Array([2])));
    urls.of(view('a'));

    expect({ first, second, revoked }).toEqual({
      first: 'blob:test/1',
      second: 'blob:test/2',
      revoked: ['blob:test/1', 'blob:test/2'],
    });
  });

  it('should revoke the URLs of items that no longer exist', () => {
    const urls = createThumbnailUrls();
    urls.of(view('a', new Uint8Array([1])));
    urls.of(view('b', new Uint8Array([2])));

    urls.keepOnly(new Set(['b']));

    expect(revoked).toEqual(['blob:test/1']);
  });

  it('should revoke every URL on clear, as when the session ends', () => {
    const urls = createThumbnailUrls();
    urls.of(view('a', new Uint8Array([1])));
    urls.of(view('b', new Uint8Array([2])));

    urls.clear();
    urls.clear();

    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);
  });
});
