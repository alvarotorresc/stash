import { describe, expect, it } from 'vitest';
import { createMemorySessionStore, createWebStorageSessionStore } from './session-store';

const SESSION = { token: 'token', expiresAt: 1_000, email: 'ada@example.com' };

class MemoryStorage implements Storage {
  #items = new Map<string, string>();
  get length() {
    return this.#items.size;
  }
  clear() {
    this.#items.clear();
  }
  getItem(key: string) {
    return this.#items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.#items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.#items.delete(key);
  }
  setItem(key: string, value: string) {
    this.#items.set(key, value);
  }
}

describe.each([
  ['memory', () => createMemorySessionStore()],
  ['web storage', () => createWebStorageSessionStore(new MemoryStorage())],
])('%s session store', (_name, create) => {
  it('should return null when empty', async () => {
    expect(await create().load()).toBeNull();
  });

  it('should load what was saved', async () => {
    const store = create();
    await store.save(SESSION);

    expect(await store.load()).toEqual(SESSION);
  });

  it('should forget the session on clear', async () => {
    const store = create();
    await store.save(SESSION);
    await store.clear();

    expect(await store.load()).toBeNull();
  });
});

describe('createWebStorageSessionStore', () => {
  it.each([
    ['not json', '{oops'],
    ['not a session', JSON.stringify({ token: 1 })],
    ['null', 'null'],
  ])('should delete a record that is %s', async (_case, raw) => {
    const storage = new MemoryStorage();
    storage.setItem('stash-session', raw);

    const loaded = await createWebStorageSessionStore(storage).load();

    expect([loaded, storage.getItem('stash-session')]).toEqual([null, null]);
  });
});
