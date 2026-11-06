import { exports } from 'cloudflare:workers';
import {
  AccountApiError,
  createAccountClient,
  createMemorySessionStore,
  decryptRecord,
  encryptRecord,
  type AccountClient,
  type DataKey,
  type DataKeyStore,
} from '@stash/core';
import { toBase64Url } from '@stash/core/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The real client against the real Worker and D1. Argon2id runs in a Web Worker with runtime
 * WebAssembly compilation, neither of which workerd offers, so this file stubs `Worker` with
 * one that answers with HKDF over the password and salt. Everything else (key chain, wrapping,
 * wire format, Worker and database) is the production code.
 */
class FastKdfWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: unknown = null;
  onmessageerror: unknown = null;

  postMessage({ password, salt }: { password: Uint8Array; salt: Uint8Array }): void {
    void (async () => {
      const material = new Uint8Array(password.length + salt.length);
      material.set(password);
      material.set(salt, password.length);
      const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, [
        'deriveBits',
        'deriveKey',
      ]);
      const hkdf = (info: string) => ({
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode(info),
      });
      const sent = await crypto.subtle.deriveBits(hkdf('stash/v1/login-key'), base, 256);
      const kek = await crypto.subtle.deriveKey(
        hkdf('stash/v1/password-kek'),
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['wrapKey', 'unwrapKey'],
      );
      this.onmessage?.({ data: { ok: true, sentKey: toBase64Url(new Uint8Array(sent)), kek } });
    })();
  }

  terminate(): void {}
}

beforeAll(() => {
  vi.stubGlobal('Worker', FastKdfWorker);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';

function memoryKeyStore(): DataKeyStore & { key: DataKey | null } {
  return {
    key: null,
    async save(key) {
      this.key = key;
    },
    async load() {
      return this.key;
    },
    async clear() {
      this.key = null;
    },
  };
}

function device(): {
  client: AccountClient;
  keys: ReturnType<typeof memoryKeyStore>;
  wiped: () => number;
} {
  const keys = memoryKeyStore();
  let wipes = 0;
  const client = createAccountClient({
    baseUrl: 'https://stash.test',
    fetch: (input, init) => exports.default.fetch(new Request(input, init)),
    dataKeyStore: keys,
    sessionStore: createMemorySessionStore(),
    onLogout: () => {
      wipes += 1;
    },
  });
  return { client, keys, wiped: () => wipes };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  const error = await promise.catch((e: unknown) => e);
  return (error as AccountApiError).code;
}

describe('account client against the Worker', () => {
  it('should register on one device and unlock the same data key on another', async () => {
    const phone = device();
    const { dataKey } = await phone.client.register({
      email: 'ada@example.com',
      password: PASSWORD,
    });
    const blob = await encryptRecord(dataKey, 'item-1', new Uint8Array([1, 2, 3]));

    const desktop = device();
    const { dataKey: unlocked } = await desktop.client.login({
      email: 'ADA@example.com',
      password: PASSWORD,
    });

    expect([...(await decryptRecord(unlocked, 'item-1', blob))]).toEqual([1, 2, 3]);
  });

  it('should reject a wrong password', async () => {
    await device().client.register({ email: 'ada@example.com', password: PASSWORD });

    expect(
      await codeOf(device().client.login({ email: 'ada@example.com', password: 'nope nope nope' })),
    ).toBe('INVALID_CREDENTIALS');
  });

  it('should change the password and log the other device out', async () => {
    const phone = device();
    const { dataKey } = await phone.client.register({
      email: 'ada@example.com',
      password: PASSWORD,
    });
    const blob = await encryptRecord(dataKey, 'item-1', new Uint8Array([5]));
    const desktop = device();
    await desktop.client.login({ email: 'ada@example.com', password: PASSWORD });

    await phone.client.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    const third = device();
    const { dataKey: unlocked } = await third.client.login({
      email: 'ada@example.com',
      password: NEW_PASSWORD,
    });

    expect({
      plaintext: [...(await decryptRecord(unlocked, 'item-1', blob))],
      desktopRevoked: await codeOf(desktop.client.deleteAccount({ password: NEW_PASSWORD })),
    }).toEqual({ plaintext: [5], desktopRevoked: 'UNAUTHORIZED' });
  });

  it('should recover with the code, keep the data and close every session', async () => {
    const phone = device();
    const { dataKey, recoveryCode } = await phone.client.register({
      email: 'ada@example.com',
      password: PASSWORD,
    });
    const blob = await encryptRecord(dataKey, 'item-1', new Uint8Array([9]));

    const laptop = device();
    const recovered = await laptop.client.recover({
      email: 'ada@example.com',
      recoveryCode,
      newPassword: NEW_PASSWORD,
    });

    expect({
      plaintext: [...(await decryptRecord(recovered.dataKey, 'item-1', blob))],
      newCode: recovered.recoveryCode !== recoveryCode,
      phoneRevoked: await codeOf(
        phone.client.changePassword({ currentPassword: PASSWORD, newPassword: 'whatever else 1' }),
      ),
      oldPassword: await codeOf(
        device().client.login({ email: 'ada@example.com', password: PASSWORD }),
      ),
    }).toEqual({
      plaintext: [9],
      newCode: true,
      phoneRevoked: 'UNAUTHORIZED',
      oldPassword: 'INVALID_CREDENTIALS',
    });
  });

  it('should delete the account and wipe the device', async () => {
    const phone = device();
    await phone.client.register({ email: 'ada@example.com', password: PASSWORD });

    await phone.client.deleteAccount({ password: PASSWORD });

    expect({
      key: phone.keys.key,
      session: await phone.client.getSession(),
      wiped: phone.wiped(),
      login: await codeOf(device().client.login({ email: 'ada@example.com', password: PASSWORD })),
    }).toEqual({ key: null, session: null, wiped: 1, login: 'INVALID_CREDENTIALS' });
  });

  it('should log out on the server and locally', async () => {
    const phone = device();
    await phone.client.register({ email: 'ada@example.com', password: PASSWORD });

    await phone.client.logout();

    expect({
      key: phone.keys.key,
      session: await phone.client.getSession(),
      wiped: phone.wiped(),
    }).toEqual({
      key: null,
      session: null,
      wiped: 1,
    });
  });
});
