import type { DataKeyStore } from '../crypto/key-store';
import type { DataKey } from '../crypto/records';
import {
  API_PATHS,
  normalizeEmail,
  type AccountSetup,
  type PasswordSetup,
} from '../account/protocol';

interface FakeUser {
  email: string;
  keys: AccountSetup;
}

export interface RecordedCall {
  method: string;
  path: string;
  body: Record<string, unknown> | undefined;
  token: string | null;
}

/**
 * Minimal in-memory stand-in for the account API: just enough server behaviour (keys compared
 * as strings, opaque tokens) to drive the client through fetch. The real Worker is tested in
 * apps/api.
 */
export class FakeServer {
  readonly users = new Map<string, FakeUser>();
  readonly sessions = new Map<string, string>();
  readonly calls: RecordedCall[] = [];
  /** Paths that answer with this error instead of their normal response. */
  readonly failures = new Map<string, { status: number; code: string }>();
  #tokens = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : undefined;
    const auth = new Headers(init?.headers).get('Authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const call: RecordedCall = { method: init?.method ?? 'GET', path: url.pathname, body, token };
    this.calls.push(call);
    const failure = this.failures.get(url.pathname);
    if (failure !== undefined) return this.error(failure.status, failure.code);
    return this.route(call);
  };

  private data(data: unknown, status = 200): Response {
    return Response.json({ data }, { status });
  }

  private error(status: number, code: string): Response {
    return Response.json({ error: { code, message: code } }, { status });
  }

  private open(email: string) {
    this.#tokens += 1;
    const token = `token-${this.#tokens}`;
    this.sessions.set(token, email);
    return { token, expiresAt: Date.now() + 1000 * 60 * 60 };
  }

  private user(call: RecordedCall): FakeUser | undefined {
    const email = call.token === null ? undefined : this.sessions.get(call.token);
    return email === undefined ? undefined : this.users.get(email);
  }

  private route(call: RecordedCall): Response {
    const body = call.body ?? {};
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const named = this.users.get(email);
    const user = this.user(call);
    switch (`${call.method} ${call.path}`) {
      case `POST ${API_PATHS.register}`:
        if (named !== undefined) return this.error(409, 'EMAIL_TAKEN');
        this.users.set(email, { email, keys: body.keys as AccountSetup });
        return this.data({ session: this.open(email) }, 201);
      case `POST ${API_PATHS.prelogin}`:
        return this.data({ salt: named?.keys.salt, kdf: named?.keys.kdf });
      case `POST ${API_PATHS.login}`:
        if (named === undefined || named.keys.loginKey !== body.loginKey)
          return this.error(401, 'INVALID_CREDENTIALS');
        return this.data({ session: this.open(email), wrappedDataKey: named.keys.wrappedDataKey });
      case `POST ${API_PATHS.logout}`:
        if (call.token === null || !this.sessions.delete(call.token)) {
          return this.error(401, 'UNAUTHORIZED');
        }
        return this.data({ ok: true });
      case `GET ${API_PATHS.account}`:
        if (user === undefined) return this.error(401, 'UNAUTHORIZED');
        return this.data({
          email: user.email,
          salt: user.keys.salt,
          kdf: user.keys.kdf,
          createdAt: 0,
        });
      case `POST ${API_PATHS.passwordBegin}`:
        if (user === undefined) return this.error(401, 'UNAUTHORIZED');
        if (user.keys.loginKey !== body.currentLoginKey)
          return this.error(403, 'INVALID_CREDENTIALS');
        return this.data({ wrappedDataKey: user.keys.wrappedDataKey });
      case `PUT ${API_PATHS.password}`:
      case `PUT ${API_PATHS.kdf}`:
        if (user === undefined) return this.error(401, 'UNAUTHORIZED');
        if (user.keys.loginKey !== body.currentLoginKey)
          return this.error(403, 'INVALID_CREDENTIALS');
        user.keys = { ...user.keys, ...(body.keys as PasswordSetup) };
        return this.data({ ok: true });
      case `POST ${API_PATHS.recoveryStart}`:
      case `POST ${API_PATHS.recoveryComplete}`: {
        if (named === undefined || named.keys.recoveryAuthKey !== body.recoveryAuthKey) {
          return this.error(401, 'INVALID_CREDENTIALS');
        }
        if (call.path === API_PATHS.recoveryStart) {
          return this.data({ recoveryWrappedDataKey: named.keys.recoveryWrappedDataKey });
        }
        named.keys = body.keys as AccountSetup;
        for (const [token, owner] of this.sessions)
          if (owner === email) this.sessions.delete(token);
        return this.data({ session: this.open(email) });
      }
      case `DELETE ${API_PATHS.account}`:
        if (user === undefined) return this.error(401, 'UNAUTHORIZED');
        if (user.keys.loginKey !== body.loginKey) return this.error(403, 'INVALID_CREDENTIALS');
        this.users.delete(user.email);
        return this.data({ ok: true });
      default:
        return this.error(404, 'NOT_FOUND');
    }
  }
}

/** Data key store that keeps the key in memory and records how it was saved. */
export function memoryDataKeyStore() {
  const state = {
    key: null as DataKey | null,
    saves: [] as boolean[],
    clears: 0,
  };
  const store: DataKeyStore = {
    async save(key, { afterPasswordEntry }) {
      state.key = key;
      state.saves.push(afterPasswordEntry);
    },
    async load() {
      return state.key;
    },
    async clear() {
      state.key = null;
      state.clears += 1;
    },
  };
  return { store, state };
}
