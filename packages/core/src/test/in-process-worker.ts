import type { WorkerLike } from '../crypto/argon2-client';
import { handlePasswordKeyRequest, type PasswordKeyRequest } from '../crypto/password-keys';

/**
 * Node has no Web Workers, so tests run the worker's handler on the same thread. Messages are
 * still structured-cloned (and the password transferred), as a real worker would see them.
 */
export class InProcessWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  #terminated = false;

  postMessage(message: unknown, transfer: Transferable[]): void {
    const request = structuredClone(message, { transfer }) as PasswordKeyRequest;
    void handlePasswordKeyRequest(request).then((response) => {
      if (this.#terminated) return;
      this.onmessage?.(new MessageEvent('message', { data: structuredClone(response) }));
    });
  }

  terminate(): void {
    this.#terminated = true;
  }
}
