import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import {
  MAX_PULL_LIMIT,
  MAX_PUSH_RECORDS,
  RECORDS_PATH,
  type PushOperation,
} from '@stash/core/sync-protocol';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../src/extract/routes';
import worker from '../src/index';
import { accountSetup, call, dataOf, passwordSetup, randomKey, register } from './helpers';
import { countingDb } from './query-counter';

/**
 * The Workers Free plan allows 50 D1 queries per invocation (a `db.batch()` counts as one) and
 * 50 subrequests, which D1 queries and outbound fetches share. Every route stays under 45, a
 * margin under both. The README lists the counts.
 */
const MAX_QUERIES = 45;

/** Sends a request to the Worker with a D1 binding that counts its queries. */
async function measured(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<{ status: number; queries: number }> {
  const counter = countingDb(env.DB);
  const headers: Record<string, string> = { 'CF-Connecting-IP': '192.0.2.200' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.token !== undefined) headers.Authorization = `Bearer ${options.token}`;
  const request = new Request(`https://stash.test${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], {
    ...env,
    DB: counter.db,
  });
  return { status: response.status, queries: counter.queries() };
}

function creates(count: number): PushOperation[] {
  return Array.from({ length: count }, () => ({
    op: 'create',
    id: crypto.randomUUID(),
    kind: 'item',
    blob: randomKey(64),
  }));
}

describe('D1 queries per invocation', () => {
  it('should keep every account route under the limit', async () => {
    const a = await register();
    const b = await register();
    const newPassword = passwordSetup();

    const routes = {
      register: await measured(API_PATHS.register, {
        body: { email: 'measured@example.com', keys: accountSetup() },
      }),
      login: await measured(API_PATHS.login, {
        body: { email: a.email, loginKey: a.keys.loginKey },
      }),
      failedLogin: await measured(API_PATHS.login, {
        body: { email: a.email, loginKey: randomKey() },
      }),
      failedRecovery: await measured(API_PATHS.recoveryStart, {
        body: { email: a.email, recoveryAuthKey: randomKey() },
      }),
      recovery: await measured(API_PATHS.recoveryComplete, {
        body: { email: b.email, recoveryAuthKey: b.keys.recoveryAuthKey, keys: accountSetup() },
      }),
      passwordBegin: await measured(API_PATHS.passwordBegin, {
        token: a.token,
        body: { currentLoginKey: a.keys.loginKey },
      }),
      password: await measured(API_PATHS.password, {
        method: 'PUT',
        token: a.token,
        body: { currentLoginKey: a.keys.loginKey, keys: newPassword },
      }),
      deleteAccount: await measured(API_PATHS.account, {
        method: 'DELETE',
        token: a.token,
        body: { loginKey: newPassword.loginKey },
      }),
    };

    const statuses = Object.fromEntries(
      Object.entries(routes).map(([name, { status }]) => [name, status]),
    );
    const most = Math.max(...Object.values(routes).map(({ queries }) => queries));
    expect({ statuses, underLimit: most <= MAX_QUERIES }).toEqual({
      statuses: {
        register: 201,
        login: 200,
        failedLogin: 401,
        failedRecovery: 401,
        recovery: 200,
        passwordBegin: 200,
        password: 200,
        deleteAccount: 200,
      },
      underLimit: true,
    });
  });

  it('should keep the largest push and pull under the limit', async () => {
    const { token } = await register();
    const first = creates(MAX_PUSH_RECORDS);
    await dataOf(await call(RECORDS_PATH, { method: 'POST', token, body: { operations: first } }));
    const mixed: PushOperation[] = [
      ...creates(MAX_PUSH_RECORDS / 2),
      ...first
        .slice(0, MAX_PUSH_RECORDS / 4)
        .map(({ id }) => ({ op: 'put' as const, id, kind: 'item' as const, blob: randomKey(64) })),
      ...first
        .slice(MAX_PUSH_RECORDS / 4, MAX_PUSH_RECORDS / 2)
        .map(({ id }) => ({ op: 'delete' as const, id, kind: 'item' as const })),
    ];

    const push = await measured(RECORDS_PATH, { token, body: { operations: mixed } });
    const pull = await measured(`${RECORDS_PATH}?cursor=0&limit=${MAX_PULL_LIMIT}`, { token });

    expect({
      push: push.status,
      pull: pull.status,
      underLimit: Math.max(push.queries, pull.queries) <= MAX_QUERIES,
    }).toEqual({ push: 200, pull: 200, underLimit: true });
  });

  it('should keep extraction under the limit with its outbound requests', async () => {
    const { token } = await register();

    // A private address is refused after the session and the rate limit, without a fetch.
    const extraction = await measured('/api/extract', {
      token,
      body: { url: 'http://127.0.0.1/' },
    });
    // At most two documents per extraction (an X post's oEmbed and page, or a short link and
    // its target), each with its redirects.
    const fetches = 2 * (DEFAULT_LIMITS.maxRedirects + 1);

    expect({
      refused: extraction.status >= 400,
      queries: extraction.queries > 0,
      underLimit: extraction.queries + fetches <= MAX_QUERIES,
    }).toEqual({ refused: true, queries: true, underLimit: true });
  });

  it('should purge and sweep in a fixed number of queries', async () => {
    const counter = countingDb(env.DB);

    await worker.scheduled(
      createScheduledController({ cron: '17 4 * * *', scheduledTime: Date.now() }),
      { ...env, DB: counter.db },
    );

    expect(counter.queries()).toBe(1);
  });
});
