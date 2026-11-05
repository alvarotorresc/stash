/**
 * Preview image download, so the device can build the encrypted thumbnail (D12). Instagram image
 * URLs expire, so the image has to be downloaded at save time instead of keeping its URL.
 */

import { EXTRACT_IMAGE_TYPES, type ExtractImageType } from '@stash/core/extract';
import {
  guardedGet,
  mediaType,
  readBounded,
  UpstreamError,
  type RequestContext,
} from './safe-fetch';

const IMAGE_TYPES: ReadonlySet<string> = new Set(EXTRACT_IMAGE_TYPES);
const ACCEPT = 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.8';

export interface FetchedImage {
  bytes: Uint8Array;
  type: ExtractImageType;
}

function isImageType(type: string): type is ExtractImageType {
  return IMAGE_TYPES.has(type);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

const ascii = (text: string): number[] => Array.from(text, (char) => char.charCodeAt(0));

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const AVIF_BRANDS = [ascii('avif'), ascii('avis')];

/**
 * AVIF is an ISO-BMFF file: an `ftyp` box whose major brand or one of its compatible brands is
 * `avif` or `avis` (the major brand is often `mif1`, so the compatible list must be read too).
 */
function isAvif(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, ascii('ftyp'), 4)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const boxEnd = Math.min(view.getUint32(0), bytes.byteLength);
  // Major brand at 8, minor version at 12, compatible brands from 16 to the end of the box.
  for (let offset = 8; offset + 4 <= boxEnd; offset += offset === 8 ? 8 : 4) {
    if (AVIF_BRANDS.some((brand) => startsWith(bytes, brand, offset))) return true;
  }
  return false;
}

/** Whether the first bytes are those of the declared type, so a mislabelled body is not passed on. */
export function matchesSignature(bytes: Uint8Array, type: ExtractImageType): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, PNG_SIGNATURE);
    case 'image/gif':
      return startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'));
    case 'image/webp':
      return startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8);
    case 'image/avif':
      return isAvif(bytes);
  }
}

export async function fetchImage(
  url: URL,
  ctx: RequestContext,
  maxBytes: number,
): Promise<FetchedImage> {
  const { response } = await guardedGet(url, ACCEPT, ctx);
  const type = mediaType(response.headers.get('content-type'));
  if (!isImageType(type)) {
    response.body?.cancel().catch(() => undefined);
    throw new UpstreamError('UNSUPPORTED_MEDIA_TYPE');
  }
  const { bytes } = await readBounded(response, maxBytes, 'reject', ctx.signal);
  // Checked after the bounded read, so an oversized body is refused for its size first.
  if (!matchesSignature(bytes, type)) throw new UpstreamError('UNSUPPORTED_MEDIA_TYPE');
  return { bytes, type };
}
