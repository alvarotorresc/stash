import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPasswordKeyDeriver, spawnArgon2Worker, type WorkerLike } from './argon2-client';
import type { KdfParams } from './kdf';
import type { PasswordKeyResponse } from './password-keys';

const PARAMS: KdfParams = { algorithm: 'argon2id', memoryKiB: 1024, iterations: 2, parallelism: 1 };

function request() {
  return {
    password: new TextEncoder().encode('correct horse battery staple'),
    salt: new Uint8Array(16),
    params: PARAMS,
  };
}

type Behaviour = (worker: ScriptedWorker, message: unknown, transfer: Transferable[]) => void;

class ScriptedWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  terminated = false;
  transferred: Transferable[] = [];

  constructor(private readonly behaviour: Behaviour) {}

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.transferred = transfer;
    this.behaviour(this, message, transfer);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function answer(response: PasswordKeyResponse): Behaviour {
  return (worker, message, transfer) => {
    structuredClone(message, { transfer });
    queueMicrotask(() => worker.onmessage?.(new MessageEvent('message', { data: response })));
  };
}

async function kek(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['wrapKey']);
}

function harness(behaviour: Behaviour) {
  const workers: ScriptedWorker[] = [];
  const derive = createPasswordKeyDeriver(() => {
    const worker = new ScriptedWorker(behaviour);
    workers.push(worker);
    return worker;
  });
  return { derive, workers };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createPasswordKeyDeriver', () => {
  it('should return the login key and KEK from the worker and terminate it', async () => {
    const key = await kek();
    const { derive, workers } = harness(answer({ ok: true, sentKey: 'login-key', kek: key }));

    const keys = await derive(request());

    expect({ keys, terminated: workers[0]?.terminated }).toEqual({
      keys: { sentKey: 'login-key', kek: key },
      terminated: true,
    });
  });

  it('should use a fresh worker for every derivation', async () => {
    const { derive, workers } = harness(answer({ ok: true, sentKey: 'k', kek: await kek() }));

    await derive(request());
    await derive(request());

    expect({ count: workers.length, allTerminated: workers.every((w) => w.terminated) }).toEqual({
      count: 2,
      allTerminated: true,
    });
  });

  it('should transfer the password bytes, detaching them from this thread', async () => {
    const { derive, workers } = harness(answer({ ok: true, sentKey: 'k', kek: await kek() }));
    const input = request();
    const buffer = input.password.buffer;

    await derive(input);

    expect({
      transferred: workers[0]?.transferred.includes(buffer),
      length: input.password.byteLength,
    }).toEqual({ transferred: true, length: 0 });
  });

  it('should throw KDF_FAILED and terminate when the worker answers ok: false', async () => {
    const { derive, workers } = harness(answer({ ok: false }));

    await expect(derive(request())).rejects.toMatchObject({ code: 'KDF_FAILED' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('should throw KDF_FAILED and terminate when the worker crashes', async () => {
    const preventDefault = vi.fn();
    const { derive, workers } = harness((worker) => {
      const event = new Event('error') as ErrorEvent;
      event.preventDefault = preventDefault;
      queueMicrotask(() => worker.onerror?.(event));
    });

    await expect(derive(request())).rejects.toMatchObject({ code: 'KDF_FAILED' });
    expect({
      terminated: workers[0]?.terminated,
      handled: preventDefault.mock.calls.length,
    }).toEqual({ terminated: true, handled: 1 });
  });

  it('should throw KDF_FAILED and terminate when the answer cannot be deserialised', async () => {
    const { derive, workers } = harness((worker) => {
      queueMicrotask(() => worker.onmessageerror?.(new MessageEvent('messageerror')));
    });

    await expect(derive(request())).rejects.toMatchObject({ code: 'KDF_FAILED' });
    expect(workers[0]?.terminated).toBe(true);
  });

  it('should wipe the password and terminate when posting fails', async () => {
    const { derive, workers } = harness(() => {
      throw new DOMException('could not clone', 'DataCloneError');
    });
    const input = request();

    await expect(derive(input)).rejects.toMatchObject({ code: 'KDF_FAILED' });
    expect({
      terminated: workers[0]?.terminated,
      wiped: input.password.every((byte) => byte === 0),
    }).toEqual({ terminated: true, wiped: true });
  });

  it('should fail closed with KDF_FAILED and wipe the password when no worker can start', async () => {
    const derive = createPasswordKeyDeriver(() => {
      throw new ReferenceError('Worker is not defined');
    });
    const input = request();

    await expect(derive(input)).rejects.toMatchObject({ code: 'KDF_FAILED' });
    expect(input.password.every((byte) => byte === 0)).toBe(true);
  });

  it('should fail closed by default where Web Workers do not exist', async () => {
    vi.stubGlobal('Worker', undefined);

    await expect(createPasswordKeyDeriver()(request())).rejects.toMatchObject({
      code: 'KDF_FAILED',
    });
  });
});

describe('spawnArgon2Worker', () => {
  it('should start a module worker from the bundled worker entry', () => {
    const constructed = vi.fn();
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL, options: WorkerOptions) {
          constructed(url.pathname.split('/').pop(), options);
        }
      },
    );

    spawnArgon2Worker();

    expect(constructed).toHaveBeenCalledWith('argon2.worker.ts', {
      type: 'module',
      name: 'stash-argon2id',
    });
  });
});
