import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerLike } from './argon2-client';
import { INFO, splitKeyMaterial } from './key-chain';
import type { PasswordKeyRequest } from './password-keys';

// Exercise the real worker client, not the in-process stand-in from the test setup.
vi.unmock('./argon2-client');

const sodiumLoads = vi.hoisted(() => ({ count: 0 }));

vi.mock('libsodium-wrappers-sumo', () => {
  sodiumLoads.count++;
  throw new Error('libsodium must not be loaded on the page thread');
});

const PASSWORD = 'correct horse battery staple';

/**
 * Stands in for the browser's Worker. It answers with keys derived without libsodium, so the
 * test can tell whether anything on this thread still loads it.
 */
class FakeArgon2Worker implements WorkerLike {
  static spawned: FakeArgon2Worker[] = [];
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  onmessageerror: WorkerLike['onmessageerror'] = null;
  terminated = false;

  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeArgon2Worker.spawned.push(this);
  }

  postMessage(message: unknown, transfer: Transferable[]): void {
    const request = structuredClone(message, { transfer }) as PasswordKeyRequest;
    void (async () => {
      const ikm = new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new Uint8Array([...request.password, ...request.salt]),
        ),
      );
      const keys = await splitKeyMaterial(ikm, INFO.loginKey, INFO.passwordKek);
      this.onmessage?.(new MessageEvent('message', { data: { ok: true, ...keys } }));
    })();
  }

  terminate(): void {
    this.terminated = true;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeArgon2Worker.spawned = [];
});

describe('password key derivation on the page thread', () => {
  it('should never load libsodium and should terminate one worker per derivation', async () => {
    vi.stubGlobal('Worker', FakeArgon2Worker);
    const core = await import('./account');

    const account = await core.createAccountKeys(PASSWORD);
    const credentials = await core.derivePasswordCredentials(PASSWORD, account.server);
    await credentials.unlockDataKey(account.server.wrappedDataKey);

    expect({
      sodiumLoads: sodiumLoads.count,
      spawned: FakeArgon2Worker.spawned.length,
      allTerminated: FakeArgon2Worker.spawned.every((worker) => worker.terminated),
      moduleWorkers: FakeArgon2Worker.spawned.every(
        (worker) =>
          worker.options.type === 'module' && worker.url.pathname.endsWith('/argon2.worker.ts'),
      ),
    }).toEqual({ sodiumLoads: 0, spawned: 2, allTerminated: true, moduleWorkers: true });
  });
});
