/**
 * Reduces a downloaded image to the thumbnail kept, encrypted, inside the item.
 *
 * Why these numbers: an account holds at most 25 MiB over 5 000 records (about 5 KiB each, with
 * the read content), so a thumbnail has to stay small or a few hundred items would use the quota.
 * A list row shows it at 56 to 72 CSS px and the reading view at a phone's width, which 320 px
 * on the long side covers; WebP at moderate quality gives about 8 to 12 KiB for a photo at that
 * size, so 12 KiB is the target, 24 KiB the most that is accepted, and an image that cannot get
 * under it is left without thumbnail instead of weighing on the account.
 */
import type { Thumbnail, ThumbnailType } from '@stash/core/sync';
import type { FetchedImage } from './extract';

/** Longest side of the thumbnail, in pixels. */
export const THUMBNAIL_MAX_SIDE = 320;
/** The size the encoder aims for, in bytes. */
export const THUMBNAIL_TARGET_BYTES = 12 * 1024;
/** The largest thumbnail accepted when the target could not be reached, in bytes. */
export const THUMBNAIL_MAX_BYTES = 24 * 1024;
/** Decoded images over this many pixels are refused: a small file can expand to gigabytes. */
const MAX_SOURCE_PIXELS = 64_000_000;

/** Tried in order: the first size and quality that fits the target wins. */
const SIDES = [THUMBNAIL_MAX_SIDE, 240] as const;
const QUALITIES = [0.7, 0.5, 0.3] as const;
/** WebP first; JPEG where the browser cannot encode it. */
const TYPES = ['image/webp', 'image/jpeg'] as const satisfies readonly ThumbnailType[];

export interface DecodedImage {
  readonly width: number;
  readonly height: number;
  /** Frees the decoded pixels. */
  close(): void;
}

/** The pixel work, apart so the size logic can be tested without a browser. */
export interface ThumbnailCodec {
  /** Throws when the bytes are not a decodable image. */
  decode(image: FetchedImage): Promise<DecodedImage>;
  /** Null when the browser answers another type than asked (no encoder for it). */
  encode(
    source: DecodedImage,
    width: number,
    height: number,
    type: ThumbnailType,
    quality: number,
  ): Promise<Thumbnail | null>;
}

/** Never throws: any failure gives `null`, and the item is kept without thumbnail. */
export type ThumbnailMaker = (image: FetchedImage) => Promise<Thumbnail | null>;

function fit(width: number, height: number, side: number): { width: number; height: number } {
  const scale = Math.min(1, side / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

async function reduce(codec: ThumbnailCodec, source: DecodedImage): Promise<Thumbnail | null> {
  const { width, height } = source;
  if (!(width > 0 && height > 0) || width * height > MAX_SOURCE_PIXELS) return null;
  let smallest: Thumbnail | null = null;
  for (const type of TYPES) {
    let supported = true;
    for (const side of SIDES) {
      const size = fit(width, height, side);
      for (const quality of QUALITIES) {
        const result = await codec.encode(source, size.width, size.height, type, quality);
        if (result === null) {
          supported = false;
          break;
        }
        if (result.bytes.byteLength <= THUMBNAIL_TARGET_BYTES) return result;
        if (smallest === null || result.bytes.byteLength < smallest.bytes.byteLength) {
          smallest = result;
        }
      }
      if (!supported) break;
    }
    // Only fall back to the next type when this one could not be encoded at all.
    if (supported) break;
  }
  return smallest !== null && smallest.bytes.byteLength <= THUMBNAIL_MAX_BYTES ? smallest : null;
}

export function createThumbnailMaker(codec: ThumbnailCodec): ThumbnailMaker {
  return async (image) => {
    let source: DecodedImage | null = null;
    try {
      source = await codec.decode(image);
      return await reduce(codec, source);
    } catch {
      return null;
    } finally {
      source?.close();
    }
  };
}

/** What the browser codec needs from the environment; every part can be replaced in tests. */
export interface BrowserImageApi {
  createImageBitmap?: typeof createImageBitmap;
  OffscreenCanvas?: typeof OffscreenCanvas;
  createCanvas?: () => HTMLCanvasElement;
}

function browserApi(): BrowserImageApi {
  const scope = globalThis;
  return {
    createImageBitmap:
      typeof scope.createImageBitmap === 'function'
        ? scope.createImageBitmap.bind(scope)
        : undefined,
    OffscreenCanvas:
      typeof scope.OffscreenCanvas === 'function' ? scope.OffscreenCanvas : undefined,
    createCanvas:
      typeof scope.document === 'object' ? () => scope.document.createElement('canvas') : undefined,
  };
}

/** Whether this context can decode and encode images (a window, or a worker with canvases). */
export function browserThumbnailsSupported(api: BrowserImageApi = browserApi()): boolean {
  return (
    typeof api.createImageBitmap === 'function' &&
    (typeof api.OffscreenCanvas === 'function' || typeof api.createCanvas === 'function')
  );
}

function bytesOfBlob(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

/** Codec over `createImageBitmap` and a canvas, with no dependency. */
export function createBrowserThumbnailCodec(api: BrowserImageApi = browserApi()): ThumbnailCodec {
  const { createImageBitmap: decodeBitmap, OffscreenCanvas: Offscreen, createCanvas } = api;

  return {
    async decode(image) {
      if (!decodeBitmap) throw new Error('No image decoder');
      const bitmap = await decodeBitmap(new Blob([image.bytes.slice()], { type: image.type }));
      return bitmap;
    },

    async encode(source, width, height, type, quality) {
      // Bitmaps come from `decode`; the codec is the only one that sees them as such.
      const bitmap = source as ImageBitmap;
      let blob: Blob | null;
      if (Offscreen) {
        const canvas = new Offscreen(width, height);
        const context = canvas.getContext('2d');
        if (!context) return null;
        if (type === 'image/jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, 0, 0, width, height);
        blob = await canvas.convertToBlob({ type, quality });
      } else if (createCanvas) {
        const canvas = createCanvas();
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) return null;
        if (type === 'image/jpeg') {
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
        }
        context.drawImage(bitmap, 0, 0, width, height);
        blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      } else {
        return null;
      }
      // A browser without an encoder for the type answers PNG: that is not what was asked for.
      if (!blob || blob.type !== type) return null;
      return { type, bytes: await bytesOfBlob(blob) };
    },
  };
}
