import { describe, expect, it, vi } from 'vitest';
import { capturePointer } from './gestures';

describe('capturePointer', () => {
  it('should capture the pointer', () => {
    const element = document.createElement('div');
    element.setPointerCapture = vi.fn();

    capturePointer(element, 3);

    expect(element.setPointerCapture).toHaveBeenCalledWith(3);
  });

  it('should ignore a pointer that is no longer active', () => {
    const element = document.createElement('div');
    element.setPointerCapture = () => {
      throw new DOMException('No active pointer', 'NotFoundError');
    };

    expect(() => capturePointer(element, 3)).not.toThrow();
  });
});
