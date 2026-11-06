import { describe, expect, it, vi } from 'vitest';
import type { KdfParams } from '../crypto/kdf';
import { FakeServer, memoryDataKeyStore } from '../test/fake-account-server';
import { createAccountClient } from './client';
import { API_PATHS } from './protocol';
import { createMemorySessionStore } from './session-store';

// Simulates a release that raises the default parameters after the account was created.
const defaults = vi.hoisted(() => ({ current: undefined as KdfParams | undefined }));

vi.mock('../crypto/kdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../crypto/kdf')>();
  return {
    ...actual,
    get DEFAULT_KDF_PARAMS() {
      return defaults.current ?? actual.DEFAULT_KDF_PARAMS;
    },
  };
});

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct horse battery staple';
const RAISED: KdfParams = {
  algorithm: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 4,
  parallelism: 1,
};

function client(server: FakeServer) {
  return createAccountClient({
    fetch: server.fetch,
    baseUrl: 'https://stash.test',
    dataKeyStore: memoryDataKeyStore().store,
    sessionStore: createMemorySessionStore(),
  });
}

async function oldAccount(): Promise<FakeServer> {
  defaults.current = undefined;
  const server = new FakeServer();
  await client(server).register({ email: EMAIL, password: PASSWORD });
  defaults.current = RAISED;
  return server;
}

describe('login with parameters below the current defaults', () => {
  it('should send the upgrade proven with the login key it just used', async () => {
    const server = await oldAccount();
    const oldLoginKey = server.users.get(EMAIL)?.keys.loginKey;

    const { upgraded } = await client(server).login({ email: EMAIL, password: PASSWORD });
    const call = server.calls.find((c) => c.path === API_PATHS.kdf);

    expect({
      upgraded,
      proof: call?.body?.currentLoginKey === oldLoginKey,
      stored: server.users.get(EMAIL)?.keys.kdf,
    }).toEqual({ upgraded: true, proof: true, stored: RAISED });
  });

  it('should still log in when the upgrade is refused', async () => {
    const server = await oldAccount();
    server.failures.set(API_PATHS.kdf, { status: 429, code: 'RATE_LIMITED' });

    const { upgraded } = await client(server).login({ email: EMAIL, password: PASSWORD });

    expect(upgraded).toBe(false);
  });
});
