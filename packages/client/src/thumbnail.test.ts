import { describe, expect, it, vi } from 'vitest';
import type { FetchedImage } from './extract';
import {
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_MAX_SIDE,
  THUMBNAIL_TARGET_BYTES,
  browserThumbnailsSupported,
  createBrowserThumbnailCodec,
  createThumbnailMaker,
  type DecodedImage,
  type ThumbnailCodec,
} from './thumbnail';

/** A real 3x2 PNG: the signature and an IHDR chunk are enough for the fake decoder below. */
const FIXTURE_PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGP4z8AAQQxwFgBB0gX7h/C5SAAAAABJRU5ErkJggg==',
  ),
  (char) => char.charCodeAt(0),
);

function png(width: number, height: number): FetchedImage {
  const bytes = FIXTURE_PNG.slice();
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return { bytes, type: 'image/png' };
}

/** Reads the size from the IHDR chunk, as a decoder would. */
function decodePng(image: FetchedImage): DecodedImage {
  const view = new DataView(image.bytes.buffer, image.bytes.byteOffset);
  return { width: view.getUint32(16), height: view.getUint32(20), close: vi.fn() };
}

interface Encoded {
  width: number;
  height: number;
  type: string;
  quality: number;
}

/** A codec whose output size shrinks with the quality and the pixel count. */
function fakeCodec(options: { bytesAt?: (e: Encoded) => number; webp?: boolean } = {}) {
  const { bytesAt = ({ width, height, quality }) => Math.round(width * height * quality * 0.2) } =
    options;
  const encoded: Encoded[] = [];
  const decoded: DecodedImage[] = [];
  const codec: ThumbnailCodec = {
    async decode(image) {
      const result = decodePng(image);
      decoded.push(result);
      return result;
    },
    async encode(_source, width, height, type, quality) {
      encoded.push({ width, height, type, quality });
      if (type === 'image/webp' && options.webp === false) return null;
      return { type, bytes: new Uint8Array(bytesAt({ width, height, type, quality })).fill(7) };
    },
  };
  return { codec, encoded, decoded };
}

describe('createThumbnailMaker', () => {
  it('should reduce the long side to the maximum and keep the proportions', async () => {
    const { codec, encoded } = fakeCodec();

    const thumbnail = await createThumbnailMaker(codec)(png(1600, 900));

    expect(encoded[0]).toMatchObject({
      width: THUMBNAIL_MAX_SIDE,
      height: 180,
      type: 'image/webp',
    });
    expect(thumbnail?.type).toBe('image/webp');
  });

  it('should reduce a tall image by its height', async () => {
    const { codec, encoded } = fakeCodec();

    await createThumbnailMaker(codec)(png(900, 1600));

    expect(encoded[0]).toMatchObject({ width: 180, height: THUMBNAIL_MAX_SIDE });
  });

  it('should never enlarge a small image', async () => {
    const { codec, encoded } = fakeCodec();

    await createThumbnailMaker(codec)(png(100, 50));

    expect(encoded[0]).toMatchObject({ width: 100, height: 50 });
  });

  it('should stop at the first result within the target size', async () => {
    const { codec, encoded } = fakeCodec({ bytesAt: () => THUMBNAIL_TARGET_BYTES });

    const thumbnail = await createThumbnailMaker(codec)(png(1600, 900));

    expect({ tries: encoded.length, size: thumbnail?.bytes.byteLength }).toEqual({
      tries: 1,
      size: THUMBNAIL_TARGET_BYTES,
    });
  });

  it('should lower the quality and then the size until it fits the target', async () => {
    const { codec, encoded } = fakeCodec({
      bytesAt: ({ width, quality }) => (width === THUMBNAIL_MAX_SIDE ? 100_000 * quality : 5_000),
    });

    const thumbnail = await createThumbnailMaker(codec)(png(1600, 900));

    expect(encoded.map(({ width }) => width)).toEqual([320, 320, 320, 240]);
    expect(thumbnail?.bytes.byteLength).toBe(5_000);
  });

  it('should keep the smallest result when none reaches the target but it is acceptable', async () => {
    const { codec } = fakeCodec({ bytesAt: ({ quality }) => 14_000 + quality * 1000 });

    const thumbnail = await createThumbnailMaker(codec)(png(1600, 900));

    expect(thumbnail?.bytes.byteLength).toBeGreaterThan(THUMBNAIL_TARGET_BYTES);
    expect(thumbnail?.bytes.byteLength).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
    expect(thumbnail?.bytes.byteLength).toBe(14_000 + 0.3 * 1000);
  });

  it('should give no thumbnail when even the smallest is over the hard limit', async () => {
    const { codec } = fakeCodec({ bytesAt: () => THUMBNAIL_MAX_BYTES + 1 });

    expect(await createThumbnailMaker(codec)(png(1600, 900))).toBeNull();
  });

  it('should fall back to JPEG when the browser cannot encode WebP', async () => {
    const { codec, encoded } = fakeCodec({ webp: false });

    const thumbnail = await createThumbnailMaker(codec)(png(1600, 900));

    expect(encoded.map(({ type }) => type)).toEqual(['image/webp', 'image/jpeg']);
    expect(thumbnail?.type).toBe('image/jpeg');
  });

  it('should give no thumbnail when nothing can be encoded', async () => {
    const codec: ThumbnailCodec = {
      decode: async (image) => decodePng(image),
      encode: async () => null,
    };

    expect(await createThumbnailMaker(codec)(png(10, 10))).toBeNull();
  });

  it('should give no thumbnail for a corrupt image instead of throwing', async () => {
    const codec: ThumbnailCodec = {
      decode: () => Promise.reject(new Error('The source image could not be decoded')),
      encode: async () => ({ type: 'image/webp', bytes: new Uint8Array(1) }),
    };

    expect(await createThumbnailMaker(codec)(png(10, 10))).toBeNull();
  });

  it('should give no thumbnail when the encoder throws', async () => {
    const codec: ThumbnailCodec = {
      decode: async (image) => decodePng(image),
      encode: () => Promise.reject(new Error('boom')),
    };

    expect(await createThumbnailMaker(codec)(png(10, 10))).toBeNull();
  });

  it.each([
    ['an empty size', 0, 0],
    ['an absurd number of pixels (a decompression bomb)', 30_000, 30_000],
  ])('should refuse %s', async (_label, width, height) => {
    const { codec, encoded } = fakeCodec();

    expect(await createThumbnailMaker(codec)(png(width, height))).toBeNull();
    expect(encoded).toHaveLength(0);
  });

  it('should release the decoded image once done, also when it fails', async () => {
    const ok = fakeCodec();
    const failing = fakeCodec();
    failing.codec.encode = () => Promise.reject(new Error('boom'));

    await createThumbnailMaker(ok.codec)(png(10, 10));
    await createThumbnailMaker(failing.codec)(png(10, 10));

    expect(
      [...ok.decoded, ...failing.decoded].map((image) => vi.mocked(image.close).mock.calls.length),
    ).toEqual([1, 1]);
  });
});

describe('createBrowserThumbnailCodec', () => {
  const source = { width: 640, height: 360, close: vi.fn() };

  function offscreen(type: string) {
    const drawn: unknown[][] = [];
    const filled: unknown[] = [];
    class FakeOffscreen {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
      getContext() {
        return {
          drawImage: (...args: unknown[]) => drawn.push(args),
          fillRect: (...args: unknown[]) => filled.push(args),
          set fillStyle(_value: string) {},
        };
      }
      async convertToBlob(options: { type: string; quality: number }) {
        return new Blob([new Uint8Array([1, 2, 3, 4])], { type: type || options.type });
      }
    }
    return { FakeOffscreen, drawn, filled };
  }

  it('should decode with createImageBitmap from the downloaded bytes', async () => {
    const createImageBitmap = vi.fn(async () => source);
    const codec = createBrowserThumbnailCodec({ createImageBitmap, OffscreenCanvas: undefined });

    const decoded = await codec.decode({ bytes: new Uint8Array([1, 2]), type: 'image/png' });
    const [blob] = createImageBitmap.mock.calls[0] as unknown as [Blob];

    expect({ size: [decoded.width, decoded.height], type: blob.type }).toEqual({
      size: [640, 360],
      type: 'image/png',
    });
  });

  it('should draw the scaled image on an OffscreenCanvas and encode it', async () => {
    const { FakeOffscreen, drawn } = offscreen('');
    const codec = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: FakeOffscreen as unknown as typeof OffscreenCanvas,
    });

    const thumbnail = await codec.encode(source, 320, 180, 'image/webp', 0.7);

    expect(drawn).toEqual([[source, 0, 0, 320, 180]]);
    expect(thumbnail).toEqual({ type: 'image/webp', bytes: new Uint8Array([1, 2, 3, 4]) });
  });

  it('should paint a white background under a JPEG, which has no transparency', async () => {
    const { FakeOffscreen, filled } = offscreen('');
    const codec = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: FakeOffscreen as unknown as typeof OffscreenCanvas,
    });

    await codec.encode(source, 320, 180, 'image/jpeg', 0.7);

    expect(filled).toEqual([[0, 0, 320, 180]]);
  });

  it('should return null when the browser answers another type (Safari has no WebP encoder)', async () => {
    const { FakeOffscreen } = offscreen('image/png');
    const codec = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: FakeOffscreen as unknown as typeof OffscreenCanvas,
    });

    expect(await codec.encode(source, 320, 180, 'image/webp', 0.7)).toBeNull();
  });

  it('should fall back to a canvas element where OffscreenCanvas does not exist', async () => {
    const drawn: unknown[][] = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (...args: unknown[]) => drawn.push(args) }),
      toBlob: (done: (blob: Blob | null) => void, type: string) =>
        done(new Blob([new Uint8Array([9])], { type })),
    };
    const codec = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: undefined,
      createCanvas: () => canvas as unknown as HTMLCanvasElement,
    });

    const thumbnail = await codec.encode(source, 320, 180, 'image/webp', 0.7);

    expect({ size: [canvas.width, canvas.height], thumbnail }).toEqual({
      size: [320, 180],
      thumbnail: { type: 'image/webp', bytes: new Uint8Array([9]) },
    });
  });

  it('should return null when there is no 2D context or no blob', async () => {
    const noContext = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: undefined,
      createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });
    const noBlob = createBrowserThumbnailCodec({
      createImageBitmap: vi.fn(),
      OffscreenCanvas: undefined,
      createCanvas: () =>
        ({
          getContext: () => ({ drawImage: () => undefined }),
          toBlob: (done: (blob: Blob | null) => void) => done(null),
        }) as unknown as HTMLCanvasElement,
    });

    expect([
      await noContext.encode(source, 10, 10, 'image/webp', 0.5),
      await noBlob.encode(source, 10, 10, 'image/webp', 0.5),
    ]).toEqual([null, null]);
  });
});

describe('browserThumbnailsSupported', () => {
  it('should need an image decoder and a canvas', () => {
    expect([
      browserThumbnailsSupported({
        createImageBitmap: vi.fn(),
        OffscreenCanvas: class {} as never,
      }),
      browserThumbnailsSupported({ createImageBitmap: vi.fn(), createCanvas: () => ({}) as never }),
      browserThumbnailsSupported({ createImageBitmap: vi.fn() }),
      browserThumbnailsSupported({ OffscreenCanvas: class {} as never }),
    ]).toEqual([true, true, false, false]);
  });
});
