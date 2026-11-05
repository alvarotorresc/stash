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
  return { bytes, type };
}
