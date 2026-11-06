import { describe, expect, it, vi } from 'vitest';
import { decryptRecord, encryptRecord } from '../crypto/records';
import { FakeServer, memoryDataKeyStore } from '../test/fake-account-server';
import { AccountApiError } from './api-client';
import { createAccountClient } from './client';
import { API_PATHS } from './protocol';
import { createMemorySessionStore } from './session-store';

const EMAIL = 'ada@example.com';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new passphrase';

function setUp() {
  const server = new FakeServer();
  const keys = memoryDataKeyStore();
  const sessionStore = createMemorySessionStore();
  const onLogout = vi.fn();
  const client = createAccountClient({
    baseUrl: 'https://stash.test',
    fetch: server.fetch,
    dataKeyStore: keys.store,
    sessionStore,
    onLogout,
  });
  return { server, keys, sessionStore, onLogout, client };
}

async function registered() {
  const context = setUp();
  const result = await context.client.register({ email: EMAIL, password: PASSWORD });
  return { ...context, ...result };
}

describe('createAccountClient', () => {
  describe('register', () => {
    it('should send the account setup, keep the session and remember the data key', async () => {
      const { server, keys, client } = await registered();

      expect({
        sent: Object.keys(server.calls[0]?.body?.keys as object).sort(),
        session: (await client.getSession())?.email,
        remembered: keys.state.saves,
      }).toEqual({
        sent: [
          'kdf',
          'loginKey',
          'recoveryAuthKey',
          'recoveryWrappedDataKey',
          'salt',
          'wrappedDataKey',
        ],
        session: EMAIL,
        remembered: [true],
      });
    });

    it('should never send the password', async () => {
      const { server } = await registered();

      expect(JSON.stringify(server.calls).includes(PASSWORD)).toBe(false);
    });

    it('should return the recovery code to show once', async () => {
      const { recoveryCode } = await registered();

      expect(recoveryCode).toMatch(/^[0-9A-Z-]+$/);
    });

    it('should store nothing when the server refuses', async () => {
      const { server, keys, client } = setUp();
      server.failures.set(API_PATHS.register, { status: 409, code: 'EMAIL_TAKEN' });

      const error = await client.register({ email: EMAIL, password: PASSWORD }).catch((e) => e);

      expect({
        code: (error as AccountApiError).code,
        saves: keys.state.saves.length,
        session: await client.getSession(),
      }).toEqual({ code: 'EMAIL_TAKEN', saves: 0, session: null });
    });
  });

  describe('login', () => {
    it('should unlock the same data key on another device', async () => {
      const first = await registered();
      const blob = await encryptRecord(first.dataKey, 'item-1', new Uint8Array([7, 8, 9]));
      const other = setUp();
      other.server.users.set(EMAIL, first.server.users.get(EMAIL)!);

      const { dataKey, upgraded } = await other.client.login({ email: EMAIL, password: PASSWORD });

      expect({
        plaintext: [...(await decryptRecord(dataKey, 'item-1', blob))],
        upgraded,
        remembered: other.keys.state.saves,
        session: (await other.client.getSession())?.email,
      }).toEqual({ plaintext: [7, 8, 9], upgraded: false, remembered: [true], session: EMAIL });
    });

    it('should fail with INVALID_CREDENTIALS for a wrong password and store nothing', async () => {
      const { client, keys } = await registered();
      await client.logout();

      const error = await client
        .login({ email: EMAIL, password: 'wrong password!' })
        .catch((e) => e);

      expect({ code: (error as AccountApiError).code, saves: keys.state.saves.length }).toEqual({
        code: 'INVALID_CREDENTIALS',
        saves: 1,
      });
    });
  });

  describe('logout', () => {
    it('should close the server session and forget the key, the session and the cache', async () => {
      const { server, keys, client, onLogout } = await registered();

      await client.logout();

      expect({
        sessions: server.sessions.size,
        key: keys.state.key,
        session: await client.getSession(),
        cacheWiped: onLogout.mock.calls.length,
      }).toEqual({ sessions: 0, key: null, session: null, cacheWiped: 1 });
    });

    it('should still forget everything locally when the server cannot be reached', async () => {
      const { server, keys, client, onLogout } = await registered();
      server.failures.set(API_PATHS.logout, { status: 503, code: 'INTERNAL_ERROR' });

      await client.logout();

      expect({
        key: keys.state.key,
        session: await client.getSession(),
        cache: onLogout.mock.calls.length,
      }).toEqual({
        key: null,
        session: null,
        cache: 1,
      });
    });

    it('should run every local step and report the first failure', async () => {
      const { keys, client, onLogout } = await registered();
      keys.store.clear = () => Promise.reject(new Error('disk full'));

      const error = await client.logout().catch((e) => e);

      expect({
        message: (error as Error).message,
        session: await client.getSession(),
        cache: onLogout.mock.calls.length,
      }).toEqual({ message: 'disk full', session: null, cache: 1 });
    });

    it('should work without a session', async () => {
      const { client, server, onLogout } = setUp();

      await client.logout();

      expect({ calls: server.calls.length, cache: onLogout.mock.calls.length }).toEqual({
        calls: 0,
        cache: 1,
      });
    });
  });

  describe('changePassword', () => {
    it('should re-wrap the data key so the new password logs in and the old one does not', async () => {
      const { client, server, dataKey } = await registered();
      const blob = await encryptRecord(dataKey, 'item-1', new Uint8Array([1]));

      await client.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      const other = setUp();
      other.server.users.set(EMAIL, server.users.get(EMAIL)!);
      const { dataKey: unlocked } = await other.client.login({
        email: EMAIL,
        password: NEW_PASSWORD,
      });
      const old = await other.client.login({ email: EMAIL, password: PASSWORD }).catch((e) => e);

      expect({
        plaintext: [...(await decryptRecord(unlocked, 'item-1', blob))],
        old: (old as AccountApiError).code,
      }).toEqual({ plaintext: [1], old: 'INVALID_CREDENTIALS' });
    });

    it('should get the wrapped data key only by proving the current password', async () => {
      const { client, server } = await registered();
      server.calls.length = 0;

      await client.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(
        server.calls.map(({ method, path, body }) => [method, path, Object.keys(body ?? {})]),
      ).toEqual([
        ['GET', API_PATHS.account, []],
        ['POST', API_PATHS.passwordBegin, ['currentLoginKey']],
        ['PUT', API_PATHS.password, ['currentLoginKey', 'keys']],
      ]);
    });

    it('should change nothing when the current password is wrong', async () => {
      const { client, server, keys } = await registered();
      const before = server.users.get(EMAIL)?.keys;

      const error = await client
        .changePassword({ currentPassword: 'not the password', newPassword: NEW_PASSWORD })
        .catch((e) => e);

      expect({
        code: (error as AccountApiError).code,
        keys: server.users.get(EMAIL)?.keys === before,
        saves: keys.state.saves,
        put: server.calls.some(({ path }) => path === API_PATHS.password),
      }).toEqual({ code: 'INVALID_CREDENTIALS', keys: true, saves: [true], put: false });
    });

    it('should remember the data key again after the password entry', async () => {
      const { client, keys } = await registered();

      await client.changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

      expect(keys.state.saves).toEqual([true, true]);
    });

    it('should fail with UNAUTHORIZED when not logged in', async () => {
      const { client } = setUp();

      const error = await client
        .changePassword({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .catch((e) => e);

      expect((error as AccountApiError).code).toBe('UNAUTHORIZED');
    });
  });

  describe('recover', () => {
    it('should set a new password, keep the data and issue a new recovery code', async () => {
      const first = await registered();
      const blob = await encryptRecord(first.dataKey, 'item-1', new Uint8Array([4, 2]));
      const device = setUp();
      device.server.users.set(EMAIL, first.server.users.get(EMAIL)!);

      const { recoveryCode, dataKey } = await device.client.recover({
        email: EMAIL,
        recoveryCode: first.recoveryCode,
        newPassword: NEW_PASSWORD,
      });
      await device.client.logout();
      const { dataKey: afterLogin } = await device.client.login({
        email: EMAIL,
        password: NEW_PASSWORD,
      });

      expect({
        recovered: [...(await decryptRecord(dataKey, 'item-1', blob))],
        afterLogin: [...(await decryptRecord(afterLogin, 'item-1', blob))],
        newCode: recoveryCode !== first.recoveryCode,
      }).toEqual({ recovered: [4, 2], afterLogin: [4, 2], newCode: true });
    });

    it('should fail for a recovery code of another account', async () => {
      const first = await registered();
      const other = await setUp().client.register({ email: 'bob@example.com', password: PASSWORD });

      const error = await first.client
        .recover({ email: EMAIL, recoveryCode: other.recoveryCode, newPassword: NEW_PASSWORD })
        .catch((e) => e);

      expect((error as AccountApiError).code).toBe('INVALID_CREDENTIALS');
    });
  });

  describe('deleteAccount', () => {
    it('should prove the password, delete the account and forget everything local', async () => {
      const { client, server, keys, onLogout } = await registered();

      await client.deleteAccount({ password: PASSWORD });

      expect({
        users: server.users.size,
        key: keys.state.key,
        session: await client.getSession(),
        cache: onLogout.mock.calls.length,
      }).toEqual({ users: 0, key: null, session: null, cache: 1 });
    });

    it('should keep everything when the password is wrong', async () => {
      const { client, server, keys } = await registered();

      const error = await client.deleteAccount({ password: 'not the password' }).catch((e) => e);

      expect({
        code: (error as AccountApiError).code,
        users: server.users.size,
        key: keys.state.key !== null,
      }).toEqual({ code: 'INVALID_CREDENTIALS', users: 1, key: true });
    });

    it('should fail with UNAUTHORIZED when not logged in', async () => {
      const { client } = setUp();

      const error = await client.deleteAccount({ password: PASSWORD }).catch((e) => e);

      expect((error as AccountApiError).code).toBe('UNAUTHORIZED');
    });
  });

  describe('getSession', () => {
    it('should treat an expired session as none', async () => {
      const { sessionStore, client } = setUp();
      await sessionStore.save({ token: 't', email: EMAIL, expiresAt: Date.now() - 1 });

      expect(await client.getSession()).toBeNull();
    });
  });
});
