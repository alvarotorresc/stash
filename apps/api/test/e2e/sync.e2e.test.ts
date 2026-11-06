import { exports } from 'cloudflare:workers';
import type { DataKey } from '@stash/core';
import { API_PATHS, toBase64Url } from '@stash/core/protocol';
import { createIndexedDbRecordCache, createSyncClient, type SyncClient } from '@stash/core/sync';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

/**
 * The real sync client (encryption, IndexedDB cache, offline queue) against the real Worker and
 * D1. Accounts are created through the API with random keys, since the server only checks their
 * shape; the data key is generated here as the key chain would hand it over after login.
 */

function random(bytes: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const workerFetch: typeof fetch = (input, init) => exports.default.fetch(new Request(input, init));

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await workerFetch(`https://stash.test${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': `10.0.${crypto.getRandomValues(new Uint8Array(2)).join('.')}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { data: T };
  return json.data;
}

interface Account {
  email: string;
  loginKey: string;
  token: string;
  key: DataKey;
}

let accounts = 0;

async function newAccount(): Promise<Account> {
  accounts += 1;
  const email = `sync${accounts}@example.com`;
  const loginKey = random(32);
  const keys = {
    salt: random(16),
    kdf: { algorithm: 'argon2id', memoryKiB: 65536, iterations: 3, parallelism: 1 },
    loginKey,
    wrappedDataKey: random(61),
    recoveryAuthKey: random(32),
    recoveryWrappedDataKey: random(61),
  };
  const { session } = await post<{ session: { token: string } }>(API_PATHS.register, {
    email,
    keys,
  });
  const key = (await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])) as DataKey;
  return { email, loginKey, token: session.token, key };
}

/** A second session of the same account, as another device would open it. */
async function secondSession(account: Account): Promise<string> {
  const { session } = await post<{ session: { token: string } }>(API_PATHS.login, {
    email: account.email,
    loginKey: account.loginKey,
  });
  return session.token;
}

function device(
  token: string,
  key: DataKey,
): { client: SyncClient; network: { online: boolean }; pushes: () => number } {
  const network = { online: true };
  let pushes = 0;
  const client = createSyncClient({
    baseUrl: 'https://stash.test',
    fetch: (input, init) => {
      if (!network.online) return Promise.reject(new TypeError('Failed to fetch'));
      if (init?.method === 'POST') pushes += 1;
      return workerFetch(input, init);
    },
    getToken: async () => token,
    getDataKey: async () => key,
    cache: createIndexedDbRecordCache({ indexedDB: new IDBFactory() }),
    isOnline: () => network.online,
  });
  return { client, network, pushes: () => pushes };
}

describe('sync client against the Worker', () => {
  it('should carry saves, changes and deletions from one device to another', async () => {
    const account = await newAccount();
    const phone = device(account.token, account.key);
    const desktop = device(await secondSession(account), account.key);
    await phone.client.open();
    await desktop.client.open();

    const category = await phone.client.createCategory('Leer luego');
    const kept = await phone.client.saveLink({
      url: 'https://example.com/kept',
      categoryId: category.id,
      tags: ['cena'],
    });
    const gone = await phone.client.saveLink({ url: 'https://example.com/gone' });
    await desktop.client.sync();
    const first = desktop.client.listItems().map(({ url }) => url);

    await phone.client.deleteItem(gone.id);
    await phone.client.deleteCategory(category.id);
    await desktop.client.sync();

    expect({
      first,
      after: desktop.client.listItems().map(({ id, category: c, tags }) => ({
        id,
        category: c,
        tags: tags.map(({ name }) => name),
      })),
    }).toEqual({
      first: ['https://example.com/gone', 'https://example.com/kept'],
      after: [{ id: kept.id, category: null, tags: ['cena'] }],
    });
  });

  it('should upload an offline save once when the connection comes back', async () => {
    const account = await newAccount();
    const phone = device(account.token, account.key);
    await phone.client.open();
    phone.network.online = false;
    await phone.client.saveLink({ url: 'https://example.com/offline' });
    phone.network.online = true;

    await Promise.all([phone.client.sync(), phone.client.sync()]);
    await phone.client.sync();
    const desktop = device(await secondSession(account), account.key);
    await desktop.client.open();
    await desktop.client.sync();

    expect({
      pushes: phone.pushes(),
      items: desktop.client.listItems().map(({ url }) => url),
    }).toEqual({ pushes: 1, items: ['https://example.com/offline'] });
  });

  it('should keep accounts apart', async () => {
    const a = await newAccount();
    const b = await newAccount();
    const phoneA = device(a.token, a.key);
    await phoneA.client.open();
    await phoneA.client.saveLink({ url: 'https://example.com/private' });

    const phoneB = device(b.token, b.key);
    await phoneB.client.open();
    const summary = await phoneB.client.sync();

    expect({ summary, items: phoneB.client.listItems() }).toEqual({
      summary: { uploaded: 0, received: 0, skipped: 0 },
      items: [],
    });
  });
});
