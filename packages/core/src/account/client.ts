import {
  changePassword as rewrapUnderNewPassword,
  createAccountKeys,
  derivePasswordCredentials,
  deriveRecoveryCredentials,
  recoverAccount,
} from '../crypto/account';
import type { DataKeyStore } from '../crypto/key-store';
import type { DataKey } from '../crypto/records';
import { AccountApiError, createApiCall, type ApiCall, type ApiClientOptions } from './api-client';
import {
  API_PATHS,
  type AccountResponse,
  type LoginResponse,
  type OkResponse,
  type PreloginResponse,
  type RecoveryCompleteResponse,
  type RecoveryStartResponse,
  type RegisterResponse,
  type SessionGrant,
} from './protocol';
import type { SessionStore, StoredSession } from './session-store';

export interface AccountClientOptions extends ApiClientOptions {
  /** Remembers the data key on the device (see `createIndexedDbDataKeyStore`). */
  readonly dataKeyStore: DataKeyStore;
  readonly sessionStore: SessionStore;
  /**
   * Runs on logout and after the account is deleted, once the data key and the session are
   * gone. The local cache of records registers here to wipe itself.
   */
  readonly onLogout?: () => void | Promise<void>;
  readonly now?: () => number;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface AccountClient {
  /** Creates the account. Show `recoveryCode` once; it is never stored. */
  register(input: Credentials): Promise<{ recoveryCode: string; dataKey: DataKey }>;
  /**
   * Logs in. When the account's Argon2id parameters are below the current defaults it also
   * sends the upgrade; that step is best effort and `upgraded` says whether it went through.
   */
  login(input: Credentials): Promise<{ dataKey: DataKey; upgraded: boolean }>;
  /** Closes the session on the server when possible, then always forgets everything local. */
  logout(): Promise<void>;
  /** Re-wraps the data key under a new password; other sessions of the account are closed. */
  changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ dataKey: DataKey }>;
  /** Recovers with the recovery code and sets a new password. Show the new code once. */
  recover(input: {
    email: string;
    recoveryCode: string;
    newPassword: string;
  }): Promise<{ recoveryCode: string; dataKey: DataKey }>;
  /** Deletes the account after proving the password, then forgets everything local. */
  deleteAccount(input: { password: string }): Promise<void>;
  /** The current session, or null when there is none or it has expired. */
  getSession(): Promise<StoredSession | null>;
}

function notLoggedIn(): AccountApiError {
  return new AccountApiError('UNAUTHORIZED', 'Not logged in', 401);
}

export function createAccountClient(options: AccountClientOptions): AccountClient {
  const { dataKeyStore, sessionStore, onLogout, now = Date.now } = options;
  const api: ApiCall = createApiCall(options);

  /** Stores what a password entry unlocked: the data key starts a new 30-day window. */
  async function remember(email: string, session: SessionGrant, dataKey: DataKey): Promise<void> {
    await dataKeyStore.save(dataKey, { afterPasswordEntry: true });
    await sessionStore.save({ token: session.token, expiresAt: session.expiresAt, email });
  }

  async function getSession(): Promise<StoredSession | null> {
    const session = await sessionStore.load();
    if (session === null || session.expiresAt <= now()) return null;
    return session;
  }

  async function requireToken(): Promise<string> {
    const session = await getSession();
    if (session === null) throw notLoggedIn();
    return session.token;
  }

  /** Forgets the data key, the session and the cache. Every step runs even if one fails. */
  async function forgetLocal(): Promise<void> {
    const steps = [
      () => dataKeyStore.clear(),
      () => sessionStore.clear(),
      async () => onLogout?.(),
    ];
    const failures: unknown[] = [];
    for (const step of steps) {
      try {
        await step();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }

  function getAccount(token: string): Promise<AccountResponse> {
    return api<AccountResponse>({ method: 'GET', path: API_PATHS.account, token });
  }

  return {
    async register({ email, password }) {
      const keys = await createAccountKeys({ email, password });
      const { session } = await api<RegisterResponse>({
        method: 'POST',
        path: API_PATHS.register,
        body: { email, keys: keys.server },
      });
      await remember(email, session, keys.dataKey);
      return { recoveryCode: keys.recoveryCode, dataKey: keys.dataKey };
    },

    async login({ email, password }) {
      const params = await api<PreloginResponse>({
        method: 'POST',
        path: API_PATHS.prelogin,
        body: { email },
      });
      const credentials = await derivePasswordCredentials({ email, password, ...params });
      const { session, wrappedDataKey } = await api<LoginResponse>({
        method: 'POST',
        path: API_PATHS.login,
        body: { email, loginKey: credentials.loginKey },
      });
      const { dataKey, upgrade } = await credentials.unlockDataKey(wrappedDataKey);
      await remember(email, session, dataKey);

      let upgraded = false;
      if (upgrade !== null) {
        // Best effort: the data key is the same either way, and the next login offers it again.
        upgraded = await api<OkResponse>({
          method: 'PUT',
          path: API_PATHS.kdf,
          token: session.token,
          body: { currentLoginKey: credentials.loginKey, keys: upgrade },
        }).then(
          () => true,
          () => false,
        );
      }
      return { dataKey, upgraded };
    },

    async logout() {
      const session = await sessionStore.load();
      try {
        if (session !== null) {
          await api<OkResponse>({ method: 'POST', path: API_PATHS.logout, token: session.token });
        }
      } catch (error) {
        // Offline or already closed: the local data goes anyway, which is what matters here.
        if (!(error instanceof AccountApiError)) throw error;
      } finally {
        await forgetLocal();
      }
    },

    async changePassword({ currentPassword, newPassword }) {
      const token = await requireToken();
      const account = await getAccount(token);
      const result = await rewrapUnderNewPassword({
        email: account.email,
        currentPassword,
        newPassword,
        salt: account.salt,
        kdf: account.kdf,
        wrappedDataKey: account.wrappedDataKey,
      });
      await api<OkResponse>({
        method: 'PUT',
        path: API_PATHS.password,
        token,
        body: { currentLoginKey: result.currentLoginKey, keys: result.server },
      });
      await dataKeyStore.save(result.dataKey, { afterPasswordEntry: true });
      return { dataKey: result.dataKey };
    },

    async recover({ email, recoveryCode, newPassword }) {
      const recovery = await deriveRecoveryCredentials(recoveryCode);
      const { recoveryAuthKey } = recovery;
      const { recoveryWrappedDataKey } = await api<RecoveryStartResponse>({
        method: 'POST',
        path: API_PATHS.recoveryStart,
        body: { email, recoveryAuthKey },
      });
      const keys = await recoverAccount(recovery, { email, recoveryWrappedDataKey, newPassword });
      const { session } = await api<RecoveryCompleteResponse>({
        method: 'POST',
        path: API_PATHS.recoveryComplete,
        body: { email, recoveryAuthKey, keys: keys.server },
      });
      await remember(email, session, keys.dataKey);
      return { recoveryCode: keys.recoveryCode, dataKey: keys.dataKey };
    },

    async deleteAccount({ password }) {
      const token = await requireToken();
      const account = await getAccount(token);
      const { loginKey } = await derivePasswordCredentials({
        email: account.email,
        password,
        salt: account.salt,
        kdf: account.kdf,
      });
      await api<OkResponse>({
        method: 'DELETE',
        path: API_PATHS.account,
        token,
        body: { loginKey },
      });
      await forgetLocal();
    },

    getSession,
  };
}
