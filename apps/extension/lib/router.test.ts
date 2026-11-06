import { describe, expect, it, vi } from 'vitest';
import type { MessageResponse, MessageSender } from './messages';
import { createMessageHandler, listenToMessages, type MessagingApi } from './router';

const ID = 'abcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;
const POPUP: MessageSender = { id: ID, url: `${BASE}popup.html` };

type Listener = Parameters<MessagingApi['runtime']['onMessage']['addListener']>[0];

function fakeRuntime() {
  let listener: Listener = () => undefined;
  const api: MessagingApi = {
    runtime: {
      id: ID,
      getURL: (path) => `${BASE}${path}`,
      onMessage: { addListener: (callback) => (listener = callback) },
    },
  };
  const send = (message: unknown, sender: MessageSender) => {
    const sendResponse = vi.fn<(response: MessageResponse) => void>();
    const keepOpen = listener(message, sender, sendResponse);
    return { keepOpen, sendResponse };
  };
  return { api, send };
}

describe('createMessageHandler', () => {
  it('should save the link of a save-link message', async () => {
    const saveLink = vi.fn(() => Promise.resolve());
    const handle = createMessageHandler({ saveLink });

    await expect(handle({ type: 'save-link', url: 'https://example.com/' })).resolves.toEqual({
      ok: true,
    });
    expect(saveLink).toHaveBeenCalledWith('https://example.com/');
  });

  it('should answer a generic failure when saving fails', async () => {
    const handle = createMessageHandler({
      saveLink: () => Promise.reject(new Error('https://secret.example/ failed')),
    });

    await expect(handle({ type: 'save-link', url: 'https://example.com/' })).resolves.toEqual({
      ok: false,
    });
  });
});

describe('listenToMessages', () => {
  it('should handle a valid message from the popup and answer asynchronously', async () => {
    const { api, send } = fakeRuntime();
    const handle = vi.fn(() => Promise.resolve({ ok: true as const }));
    listenToMessages(api, handle);

    const { keepOpen, sendResponse } = send(
      { type: 'save-link', url: 'https://example.com/a' },
      POPUP,
    );

    expect(keepOpen).toBe(true);
    expect(handle).toHaveBeenCalledWith({ type: 'save-link', url: 'https://example.com/a' });
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it('should ignore messages from tabs and other extensions without answering', () => {
    const { api, send } = fakeRuntime();
    const handle = vi.fn(() => Promise.resolve({ ok: true as const }));
    listenToMessages(api, handle);
    const message = { type: 'save-link', url: 'https://example.com/a' };

    const fromTab = send(message, { id: ID, url: 'https://evil.example/', tab: { id: 1 } });
    const fromOther = send(message, { id: 'other', url: 'chrome-extension://other/x.html' });

    expect(fromTab.keepOpen).toBeUndefined();
    expect(fromOther.keepOpen).toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
  });

  it('should ignore unknown or malformed messages from the popup', () => {
    const { api, send } = fakeRuntime();
    const handle = vi.fn(() => Promise.resolve({ ok: true as const }));
    listenToMessages(api, handle);

    expect(send({ type: 'wipe' }, POPUP).keepOpen).toBeUndefined();
    expect(send({ type: 'save-link', url: 'javascript:1' }, POPUP).keepOpen).toBeUndefined();
    expect(handle).not.toHaveBeenCalled();
  });
});
