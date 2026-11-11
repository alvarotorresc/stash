import {
  createIndexedDbDataKeyStore,
  createMemorySessionStore,
  type SessionStore,
} from '@stash/core';
import { createIndexedDbRecordCache, type Thumbnail } from '@stash/core/sync';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readHtml } from './read';
import { createStash, type Stash, type StashOptions } from './stash';
import { FakeBackend, webPage } from './test/backend';
import type { ThumbnailMaker } from './thumbnail';

const EMAIL = 'maria@ejemplo.com';
const PASSWORD = 'calabaza-asada-2026';
const PAGE = 'https://blog.example.com/despensa';
const IMAGE = 'https://cdn.example.com/cover.jpg';
/** Recognisable bytes: if they show up in IndexedDB, the thumbnail was stored in the clear. */
const MARKER = Uint8Array.from({ length: 24 }, (_, index) => 0xa0 + index);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** Always makes the same thumbnail: marker bytes repeated, so a leak is easy to find. */
function marked(): ThumbnailMaker {
  const bytes = new Uint8Array(MARKER.length * 40);
  for (let index = 0; index < 40; index++) bytes.set(MARKER, index * MARKER.length);
  return vi.fn(async () => ({ type: 'image/webp', bytes }) satisfies Thumbnail);
}

const opened: Stash[] = [];

afterEach(async () => {
  for (const stash of opened.splice(0)) {
    await stash.idle();
    stash.dispose();
  }
});

interface Device {
  stash: Stash;
  factory: IDBFactory;
  sessionStore: SessionStore;
}

function device(
  backend: FakeBackend,
  makeThumbnail: ThumbnailMaker | null,
  shared?: Device,
  extra: Partial<StashOptions> = {},
): Device {
  const factory = shared?.factory ?? new IDBFactory();
  const sessionStore = shared?.sessionStore ?? createMemorySessionStore();
  const stash = createStash({
    baseUrl: 'https://stash.test',
    fetch: backend.fetch,
    sessionStore,
    dataKeyStore: createIndexedDbDataKeyStore({ indexedDB: factory }),
    cache: createIndexedDbRecordCache({ indexedDB: factory }),
    isOnline: () => backend.online,
    events: new EventTarget(),
    makeThumbnail,
    ...extra,
  });
  opened.push(stash);
  return { stash, factory, sessionStore };
}

async function signedIn(makeThumbnail: ThumbnailMaker | null = marked()) {
  const backend = new FakeBackend();
  const phone = device(backend, makeThumbnail);
  await phone.stash.register({ email: EMAIL, password: PASSWORD });
  await phone.stash.idle();
  return { backend, phone };
}

function pageWithImage(backend: FakeBackend, url = PAGE, image = IMAGE) {
  backend.pages.set(url, webPage(url, 'La despensa', ['uno dos tres'], image));
}

/** Every byte string and text stored in the cache, to look for what must not be there. */
async function storedBytes(factory: IDBFactory): Promise<Uint8Array[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open('stash-cache');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const found: Uint8Array[] = [];
  const walk = (value: unknown): void => {
    if (value instanceof Uint8Array) found.push(value);
    else if (value instanceof ArrayBuffer) found.push(new Uint8Array(value));
    else if (typeof value === 'string') found.push(new TextEncoder().encode(value));
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk);
  };
  for (const name of db.objectStoreNames) {
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction(name).objectStore(name).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    values.forEach(walk);
  }
  db.close();
  return found;
}

function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let start = 0; start + needle.length <= haystack.length; start++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[start + index] !== needle[index]) continue outer;
    }
    return true;
  }
  return false;
}

describe('thumbnails', () => {
  it('should download the image through the proxy and keep the thumbnail with the item', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    const item = phone.stash.sync.getItem(saved.id);

    expect({
      type: item?.thumbnail?.type,
      size: item?.thumbnail?.bytes.byteLength,
      imageRequests: backend.imagesFetched,
    }).toEqual({ type: 'image/webp', size: MARKER.length * 40, imageRequests: [IMAGE] });
  });

  it('should store the thumbnail only encrypted: the image is not in IndexedDB in the clear', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });

    await phone.stash.save(PAGE);
    await phone.stash.idle();
    const stored = await storedBytes(phone.factory);
    const serverBlobs = [...backend.records.rows().values()].map((row) => row.blob ?? '');

    expect({
      cachedSomething: stored.length > 0,
      inCache: stored.some((bytes) => contains(bytes, MARKER)),
      jpegInCache: stored.some((bytes) => contains(bytes, JPEG)),
      onServer: serverBlobs.some((blob) => blob.includes(String.fromCharCode(...MARKER))),
    }).toEqual({ cachedSomething: true, inCache: false, jpegInCache: false, onServer: false });
  });

  it('should find the marker in the detector itself, so the check above can fail', () => {
    expect(contains(new Uint8Array([9, ...MARKER, 9]), MARKER)).toBe(true);
    expect(contains(new Uint8Array([9, 9]), MARKER)).toBe(false);
  });

  it('should keep the item with no thumbnail when the image is corrupt', async () => {
    const make = vi.fn(async () => null);
    const { backend, phone } = await signedIn(make);
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]) });

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    const item = phone.stash.sync.getItem(saved.id);

    expect({
      title: item?.title,
      thumbnail: item?.thumbnail,
      imageUrl: item?.preview?.imageUrl,
      decoded: make.mock.calls.length,
    }).toEqual({ title: 'La despensa', thumbnail: null, imageUrl: IMAGE, decoded: 1 });
  });

  it('should keep the item when the maker throws', async () => {
    const make = vi.fn(async () => {
      throw new Error('boom');
    });
    const { backend, phone } = await signedIn(make);
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();

    expect(phone.stash.sync.getItem(saved.id)).toMatchObject({
      title: 'La despensa',
      thumbnail: null,
    });
  });

  it('should refuse an SVG from the proxy and never decode it', async () => {
    const make = marked();
    const { backend, phone } = await signedIn(make);
    pageWithImage(backend);
    backend.images.set(IMAGE, {
      type: 'image/svg+xml',
      bytes: new TextEncoder().encode('<svg onload="x()"/>'),
    });

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();

    expect({
      thumbnail: phone.stash.sync.getItem(saved.id)?.thumbnail,
      decoded: vi.mocked(make).mock.calls.length,
    }).toEqual({ thumbnail: null, decoded: 0 });
  });

  it('should not ask for an image that is not an http address, such as a data: URI', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend, PAGE, 'data:image/png;base64,AAAA');

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();

    expect({
      thumbnail: phone.stash.sync.getItem(saved.id)?.thumbnail,
      imageRequests: backend.imagesFetched,
    }).toEqual({ thumbnail: null, imageRequests: [] });
  });

  it('should save and read the page without any image request when there is no image', async () => {
    const { backend, phone } = await signedIn();
    backend.pages.set(PAGE, webPage(PAGE, 'La despensa', ['uno dos tres']));

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();

    expect(backend.imagesFetched).toEqual([]);
    expect(phone.stash.sync.getItem(saved.id)?.title).toBe('La despensa');
  });

  it('should try twice at most: when saving and on the next sync, then drop the address', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend);

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    const afterSave = backend.imagesFetched.length;
    await phone.stash.refresh();
    const afterSync = backend.imagesFetched.length;
    const dropped = phone.stash.sync.getItem(saved.id)?.preview?.imageUrl;
    await phone.stash.refresh();
    await phone.stash.refresh();

    expect({
      afterSave,
      afterSync,
      final: backend.imagesFetched.length,
      dropped,
      kept: phone.stash.sync.getItem(saved.id)?.title,
    }).toEqual({ afterSave: 1, afterSync: 2, final: 2, dropped: null, kept: 'La despensa' });
  });

  it('should not spend the second try in the same sync that failed the first', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend);
    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    backend.imagesFetched.length = 0;

    // A refresh that reads nothing new: it is the "next sync".
    await phone.stash.refresh();

    expect(backend.imagesFetched).toEqual([IMAGE]);
    expect(phone.stash.sync.getItem(saved.id)?.thumbnail).toBeNull();
  });

  it('should not count a rate limit or a missing connection as an attempt', async () => {
    const { backend, phone } = await signedIn();
    pageWithImage(backend);
    backend.images.set(IMAGE, { status: 429, code: 'RATE_LIMITED' });
    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    await phone.stash.refresh();
    await phone.stash.refresh();
    const stillThere = phone.stash.sync.getItem(saved.id)?.preview?.imageUrl;

    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });
    await phone.stash.refresh();

    expect({ stillThere, thumbnail: phone.stash.sync.getItem(saved.id)?.thumbnail?.type }).toEqual({
      stillThere: IMAGE,
      thumbnail: 'image/webp',
    });
  });

  it('should stop the batch at the first transient failure', async () => {
    const { backend, phone } = await signedIn(null);
    for (const n of [1, 2, 3]) {
      pageWithImage(backend, `${PAGE}-${n}`, `${IMAGE}?n=${n}`);
      await phone.stash.save(`${PAGE}-${n}`);
    }
    await phone.stash.idle();
    const later = device(backend, marked(), phone);
    await later.stash.session();
    backend.images.set(`${IMAGE}?n=3`, { status: 429, code: 'RATE_LIMITED' });
    backend.imagesFetched.length = 0;

    await later.stash.start();
    await later.stash.idle();

    expect(backend.imagesFetched).toHaveLength(1);
  });

  it('should fill the thumbnails of old items a few at a time, in the background', async () => {
    const { backend, phone } = await signedIn(null);
    const ids: string[] = [];
    for (let n = 0; n < 12; n++) {
      pageWithImage(backend, `${PAGE}-${n}`, `${IMAGE}?n=${n}`);
      backend.images.set(`${IMAGE}?n=${n}`, { type: 'image/jpeg', bytes: JPEG });
      ids.push((await phone.stash.save(`${PAGE}-${n}`)).id);
    }
    await phone.stash.idle();
    const withThumbnails = (stash: Stash) =>
      ids.filter((id) => stash.sync.getItem(id)?.thumbnail != null).length;
    const before = withThumbnails(phone.stash);

    const later = device(backend, marked(), phone);
    await later.stash.session();
    await later.stash.start();
    await later.stash.idle();
    const first = withThumbnails(later.stash);
    await later.stash.refresh();
    const second = withThumbnails(later.stash);

    expect({ before, first, second }).toEqual({ before: 0, first: 10, second: 12 });
  });

  it('should fill an old item once and leave it alone afterwards', async () => {
    const { backend, phone } = await signedIn(null);
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });
    await phone.stash.save(PAGE);
    await phone.stash.idle();

    const later = device(backend, marked(), phone);
    await later.stash.session();
    await later.stash.start();
    await later.stash.idle();
    await later.stash.refresh();

    expect(backend.imagesFetched).toEqual([IMAGE]);
  });

  it('should not generate thumbnails where the maker is off (the extension background)', async () => {
    const { backend, phone } = await signedIn(null);
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });

    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();
    await phone.stash.refresh();

    expect({
      imageRequests: backend.imagesFetched,
      thumbnail: phone.stash.sync.getItem(saved.id)?.thumbnail,
      imageUrl: phone.stash.sync.getItem(saved.id)?.preview?.imageUrl,
    }).toEqual({ imageRequests: [], thumbnail: null, imageUrl: IMAGE });
  });

  it('should add the thumbnail to a page the extension already read, without blocking the save', async () => {
    const { backend, phone } = await signedIn();
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });
    const html = `<html><head><title>La despensa</title><meta property="og:image" content="${IMAGE}"></head><body><article><h1>x</h1><p>uno dos tres</p></article></body></html>`;

    const saved = await phone.stash.save(PAGE, { read: readHtml(html, PAGE) });
    expect(saved.thumbnail).toBeNull();
    await phone.stash.idle();

    expect({
      pageRequests: backend.extracted,
      thumbnail: phone.stash.sync.getItem(saved.id)?.thumbnail?.type,
    }).toEqual({ pageRequests: [], thumbnail: 'image/webp' });
  });

  it('should keep the preview and content when the account has no room for the thumbnail', async () => {
    const { backend, phone } = await signedIn(null);
    pageWithImage(backend);
    backend.images.set(IMAGE, { type: 'image/jpeg', bytes: JPEG });
    const saved = await phone.stash.save(PAGE);
    await phone.stash.idle();

    const later = device(backend, marked(), phone);
    await later.stash.session();
    // Runs while the sync pull is answered: the write that follows (the thumbnail) is refused.
    backend.records.beforePull = () => {
      backend.records.beforePull = null;
      backend.records.nextError = { status: 413, code: 'QUOTA_EXCEEDED' };
    };
    await later.stash.start();
    await later.stash.idle();
    const item = later.stash.sync.getItem(saved.id);

    expect({
      title: item?.title,
      hasContent: item?.content !== null,
      thumbnail: item?.thumbnail,
      imageUrl: item?.preview?.imageUrl,
    }).toEqual({ title: 'La despensa', hasContent: true, thumbnail: null, imageUrl: null });
  });
});
