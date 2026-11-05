/**
 * Keeps a drag going when the finger leaves the element. Capture can fail
 * (the pointer is already gone, or the browser lacks it); the drag still
 * works within the element, so the failure is ignored.
 */
export function capturePointer(element: Element, pointerId: number) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Pointer no longer active: nothing to capture.
  }
}
