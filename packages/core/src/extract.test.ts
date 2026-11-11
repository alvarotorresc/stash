import { describe, expect, it } from 'vitest';
import {
  EXTRACT_ERROR_CODES,
  EXTRACT_IMAGE_TYPES,
  EXTRACT_MAX_IMAGE_BYTES,
  EXTRACT_MAX_URL_LENGTH,
} from './extract';

describe('extract contract', () => {
  it('should never accept svg images, which can carry scripts', () => {
    expect(EXTRACT_IMAGE_TYPES).not.toContain('image/svg+xml');
    expect(EXTRACT_IMAGE_TYPES.every((type) => type.startsWith('image/'))).toBe(true);
  });

  it('should list each error code once', () => {
    expect(new Set(EXTRACT_ERROR_CODES).size).toBe(EXTRACT_ERROR_CODES.length);
  });

  it('should cap the url length', () => {
    expect(EXTRACT_MAX_URL_LENGTH).toBe(2048);
  });

  it('should cap the image size the proxy hands back at 5 MiB', () => {
    expect(EXTRACT_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
