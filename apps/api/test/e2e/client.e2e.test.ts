import { exports } from 'cloudflare:workers';
import { createStash, type Stash } from '@stash/client';
import { FastKdfWorker } from '@stash/client/testing';
import { createMemorySessionStore } from '@stash/core';
import { createIndexedDbRecordCache } from '@stash/core/sync';
import { memoryDataKeyStore } from '@stash/core/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The client the apps use (`@stash/client`: key chain, sync, encrypted cache and extraction)
 * against the real Worker and D1: sign up, save, read on another device, log out. Argon2id is
 * stubbed as in the account tests (workerd has no Web Workers). The saved link points to a
 * private address, which the proxy refuses without any outbound request, so the test needs no
 * network and shows that such a save keeps the bare link.
 */

const PASSWORD = 'correct horse battery staple';
const LINK = 'http://127.0.0.1/private-note';

beforeAll(() => {
  vi.stubGlobal('Worker', FastKdfWorker);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

const devices: Stash[] = [];

afterEach(async () => {
  for (const stash of devices.splice(0)) {
    await stash.idle();
    stash.dispose();
  }
});

function device(): Stash {
  const stash = createStash({
    baseUrl: 'https://stash.test',
    fetch: (input, init) => exports.default.fetch(new Request(input, init)),
    sessionStore: createMemorySessionStore(),
    dataKeyStore: memoryDataKeyStore().store,
    cache: createIndexedDbRecordCache({ indexedDB: new IDBFactory() }),
    isOnline: () => true,
    // workerd has no DOM; nothing here needs to parse a page.
    readPages: true,
    events: null,
  });
  devices.push(stash);
  return stash;
}

describe('the apps client against the Worker', () => {
  it('should sign up, save, read on another device and log out', async () => {
    const phone = device();
    const { recoveryCode } = await phone.register({ email: 'ada@example.com', password: PASSWORD });
    const saved = await phone.save(LINK);
    await phone.idle();
    const onPhone = phone.sync.getItem(saved.id);

    const laptop = device();
    await laptop.login({ email: 'ada@example.com', password: PASSWORD });
    await laptop.idle();
    const onLaptop = laptop.sync.getItem(saved.id);
    await laptop.logout();

    expect({
      code: recoveryCode.length > 0,
      queued: saved.queued,
      phone: { url: onPhone?.url, read: onPhone?.preview !== null, kind: onPhone?.content?.kind },
      laptop: { url: onLaptop?.url, status: onLaptop?.status, title: onLaptop?.title },
      afterLogout: { session: await laptop.session(), items: laptop.sync.listItems().length },
      phoneStillIn: (await phone.session())?.email,
    }).toEqual({
      code: true,
      queued: false,
      phone: { url: LINK, read: true, kind: 'none' },
      laptop: { url: LINK, status: 'pending', title: LINK },
      afterLogout: { session: null, items: 0 },
      phoneStillIn: 'ada@example.com',
    });
  });

  it('should send the phone back to the login when the password changes elsewhere', async () => {
    const phone = device();
    await phone.register({ email: 'grace@example.com', password: PASSWORD });
    const laptop = device();
    await laptop.login({ email: 'grace@example.com', password: PASSWORD });

    await laptop.changePassword({ currentPassword: PASSWORD, newPassword: 'another long phrase' });
    await phone.refresh();

    expect({
      phone: await phone.session(),
      email: await phone.lastEmail(),
      laptop: (await laptop.session())?.email,
    }).toEqual({ phone: null, email: 'grace@example.com', laptop: 'grace@example.com' });
  });
});
