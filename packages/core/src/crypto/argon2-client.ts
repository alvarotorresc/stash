import { CryptoError } from './errors';
import type { PasswordKeyRequest, PasswordKeyResponse, PasswordKeys } from './password-keys';

/**
 * Argon2id runs in a dedicated Web Worker, one per derivation, terminated as soon as it
 * answers. libsodium frees its WebAssembly buffers without wiping them, so running it on the
 * page would leave the master key in a heap that any script on the origin could read later.
 * Terminating the worker drops that memory; the page only receives the login key and a
 * non-extractable KEK. It also keeps the page responsive during the 1–2 s of work.
 *
 * There is deliberately no fallback to the current thread: where Web Workers are missing (for
 * example an extension's background service worker) the derivation fails with `KDF_FAILED`.
 */
export interface WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
}

export type PasswordKeyDeriver = (request: PasswordKeyRequest) => Promise<PasswordKeys>;

/** The literal `new URL(..., import.meta.url)` lets Vite (PWA and WXT) bundle the worker. */
export function spawnArgon2Worker(): WorkerLike {
  return new Worker(new URL('./argon2.worker.ts', import.meta.url), {
    type: 'module',
    name: 'stash-argon2id',
  });
}

function kdfFailed(): CryptoError {
  return new CryptoError('KDF_FAILED', 'Could not derive the password keys');
}

export function createPasswordKeyDeriver(
  spawn: () => WorkerLike = spawnArgon2Worker,
): PasswordKeyDeriver {
  return async (request) => {
    let worker: WorkerLike;
    try {
      worker = spawn();
    } catch {
      request.password.fill(0);
      throw kdfFailed();
    }
    try {
      return await new Promise<PasswordKeys>((resolve, reject) => {
        worker.onmessage = ({ data }: MessageEvent<PasswordKeyResponse>) => {
          if (data.ok) resolve({ sentKey: data.sentKey, kek: data.kek });
          else reject(kdfFailed());
        };
        worker.onerror = (event) => {
          event.preventDefault();
          reject(kdfFailed());
        };
        worker.onmessageerror = () => reject(kdfFailed());
        try {
          // Transferring detaches the password bytes from this thread.
          worker.postMessage(request, [request.password.buffer]);
        } catch {
          reject(kdfFailed());
        }
      });
    } finally {
      worker.terminate();
      // A detached buffer has length 0; otherwise the transfer never happened.
      if (request.password.byteLength > 0) request.password.fill(0);
    }
  };
}

export const derivePasswordKeysInWorker: PasswordKeyDeriver = createPasswordKeyDeriver();
