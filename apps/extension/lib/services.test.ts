import { describe, expect, it, vi } from 'vitest';
import { createBackgroundActions, createPopupService } from './services';
import type { TabApi } from './tab';

describe('createPopupService', () => {
  it('should read the open tab from the browser', async () => {
    const api: TabApi = {
      tabs: {
        query: vi.fn(() => Promise.resolve([{ id: 1, url: 'https://example.com/', title: 'T' }])),
      },
      scripting: { executeScript: vi.fn(() => Promise.reject(new Error('blocked'))) },
    };

    const service = createPopupService(api);

    await expect(service.currentTab()).resolves.toEqual({
      url: 'https://example.com/',
      title: 'T',
    });
    await expect(service.getSession()).resolves.not.toBeNull();
  });
});

describe('createBackgroundActions', () => {
  it('should save a link by its address', async () => {
    const actions = createBackgroundActions();

    await expect(actions.saveLink('https://example.com/a')).resolves.toMatchObject({
      url: 'https://example.com/a',
      domain: 'example.com',
    });
  });
});
