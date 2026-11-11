import { describe, expect, it } from 'vitest';
import {
  MAX_PENDING_LINKS,
  PENDING_KEY,
  SESSION_KEY,
  createPendingLinks,
  createStorageSessionStore,
} from './storage';
import { memoryArea } from './test-utils';

const SESSION = { token: 'tok', expiresAt: 1_000, email: 'maria@ejemplo.com' };

describe('createStorageSessionStore', () => {
  it('should keep the session in the extension storage and read it back', async () => {
    const area = memoryArea();
    const store = createStorageSessionStore(area);

    await store.save(SESSION);

    expect({ loaded: await store.load(), stored: area.data.get(SESSION_KEY) }).toEqual({
      loaded: SESSION,
      stored: SESSION,
    });
  });

  it('should have no session when nothing is stored', async () => {
    await expect(createStorageSessionStore(memoryArea()).load()).resolves.toBeNull();
  });

  it('should only keep the three session fields, whatever it is given', async () => {
    const area = memoryArea();

    await createStorageSessionStore(area).save({ ...SESSION, password: 'x' } as typeof SESSION);

    expect(area.data.get(SESSION_KEY)).toEqual(SESSION);
  });

  it.each([
    ['a string', 'token'],
    ['a record without a token', { expiresAt: 1, email: 'a@b.c' }],
    ['a token that is not text', { ...SESSION, token: 7 }],
    ['an expiry that is not a number', { ...SESSION, expiresAt: '1' }],
    ['an expiry that is not finite', { ...SESSION, expiresAt: Number.POSITIVE_INFINITY }],
    ['null', null],
  ])('should delete %s and ask to log in again', async (_, value) => {
    const area = memoryArea({ [SESSION_KEY]: value });

    await expect(createStorageSessionStore(area).load()).resolves.toBeNull();
    expect(area.data.has(SESSION_KEY)).toBe(false);
  });

  it('should forget the session on clear', async () => {
    const area = memoryArea();
    const store = createStorageSessionStore(area);
    await store.save(SESSION);

    await store.clear();

    await expect(store.load()).resolves.toBeNull();
  });
});

describe('createPendingLinks', () => {
  const isLink = (value: string) => value.startsWith('https://');
  const links = (area = memoryArea()) => ({ area, pending: createPendingLinks(area, isLink) });

  it('should keep links in order, without repeating one', async () => {
    const { pending } = links();

    await pending.add('https://a.example/');
    await pending.add('https://b.example/');
    const count = await pending.add('https://a.example/');

    expect({ count, list: await pending.list() }).toEqual({
      count: 2,
      list: ['https://a.example/', 'https://b.example/'],
    });
  });

  it('should keep only the newest links past the cap', async () => {
    const { pending } = links();

    for (let i = 0; i < MAX_PENDING_LINKS + 3; i++) await pending.add(`https://a.example/${i}`);

    const list = await pending.list();
    expect({ length: list.length, first: list[0], last: list.at(-1) }).toEqual({
      length: MAX_PENDING_LINKS,
      first: 'https://a.example/3',
      last: `https://a.example/${MAX_PENDING_LINKS + 2}`,
    });
  });

  it('should ignore anything in storage that is not a list of links', async () => {
    const { area, pending } = links(memoryArea({ [PENDING_KEY]: 'nope' }));
    expect(await pending.list()).toEqual([]);

    area.data.set(PENDING_KEY, ['https://ok.example/', 3, 'javascript:alert(1)']);
    expect(await pending.list()).toEqual(['https://ok.example/']);
  });

  it('should remove one link, and the entry once it is empty', async () => {
    const { area, pending } = links();
    await pending.add('https://a.example/');
    await pending.add('https://b.example/');

    await pending.remove('https://a.example/');
    expect(await pending.list()).toEqual(['https://b.example/']);
    await pending.remove('https://b.example/');

    expect(area.data.has(PENDING_KEY)).toBe(false);
  });

  it('should clear every link', async () => {
    const { pending } = links();
    await pending.add('https://a.example/');

    await pending.clear();

    expect(await pending.list()).toEqual([]);
  });
});
