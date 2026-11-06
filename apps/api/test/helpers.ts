import { exports } from 'cloudflare:workers';
import {
  API_PATHS,
  DEFAULT_KDF_PARAMS,
  toBase64Url,
  type AccountSetup,
  type KdfParams,
  type PasswordSetup,
  type SessionGrant,
} from '@stash/core/protocol';
import { expect } from 'vitest';

export const BASE_URL = 'https://stash.test';

export function randomKey(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** A fresh client address per call, so per-IP limits only bite where a test means them to. */
function randomIp(): string {
  const [a, b, c] = crypto.getRandomValues(new Uint8Array(3));
  return `10.${a}.${b}.${c}`;
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  ip?: string;
  headers?: Record<string, string>;
}

export function call(path: string, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': options.ip ?? randomIp(),
    ...options.headers,
  };
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }
  return exports.default.fetch(`${BASE_URL}${path}`, {
    method: options.method ?? (body === undefined ? 'GET' : 'POST'),
    headers,
    body,
  });
}

/** The `data` of a successful response, failing the test on any other status. */
export async function dataOf<T>(response: Response, status = 200): Promise<T> {
  const json = (await response.json()) as { data: T };
  expect(response.status, JSON.stringify(json)).toBe(status);
  return json.data;
}

export async function errorOf(response: Response): Promise<{ status: number; code: string }> {
  const json = (await response.json()) as { error: { code: string } };
  return { status: response.status, code: json.error.code };
}

export function passwordSetup(kdf: KdfParams = DEFAULT_KDF_PARAMS): PasswordSetup {
  return {
    salt: randomKey(16),
    kdf: { ...kdf },
    loginKey: randomKey(),
    wrappedDataKey: randomKey(61),
  };
}

/** What `createAccountKeys` sends, with random bytes: the server only checks their shape. */
export function accountSetup(kdf?: KdfParams): AccountSetup {
  return {
    ...passwordSetup(kdf),
    recoveryAuthKey: randomKey(),
    recoveryWrappedDataKey: randomKey(61),
  };
}

let emailCounter = 0;

export function uniqueEmail(): string {
  emailCounter += 1;
  return `user${emailCounter}-${randomKey(6)}@example.com`.toLowerCase();
}

export interface TestAccount {
  email: string;
  keys: AccountSetup;
  session: SessionGrant;
  token: string;
}

export async function register(email = uniqueEmail(), keys = accountSetup()): Promise<TestAccount> {
  const { session } = await dataOf<{ session: SessionGrant }>(
    await call(API_PATHS.register, { body: { email, keys } }),
    201,
  );
  return { email, keys, session, token: session.token };
}

export async function login(email: string, loginKey: string): Promise<string> {
  const { session } = await dataOf<{ session: SessionGrant }>(
    await call(API_PATHS.login, { body: { email, loginKey } }),
  );
  return session.token;
}
