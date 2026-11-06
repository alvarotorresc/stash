import {
  isOwnExtensionPage,
  parseMessage,
  type Message,
  type MessageResponse,
  type MessageSender,
} from './messages';

export type MessageHandler = (message: Message) => Promise<MessageResponse>;

/** What the background does with each message. */
export interface BackgroundActions {
  saveLink(url: string): Promise<unknown>;
}

/** One handler for every message, whether it comes from the popup or the context menu. */
export function createMessageHandler(actions: BackgroundActions): MessageHandler {
  return async (message) => {
    try {
      // One message type today; a switch on `message.type` goes here when there are more.
      await actions.saveLink(message.url);
      return { ok: true };
    } catch {
      // Errors stay generic: nothing about the link or the failure leaves the background.
      return { ok: false };
    }
  };
}

/** The parts of the runtime API messaging uses, so tests can pass a fake. */
export interface MessagingApi {
  runtime: {
    id: string;
    getURL(path: string): string;
    onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response: MessageResponse) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
}

/**
 * Listens to messages from the extension's own pages. Anything from another sender, or that is
 * not a known message, gets no answer at all.
 */
export function listenToMessages(api: MessagingApi, handle: MessageHandler) {
  api.runtime.onMessage.addListener((value, sender, sendResponse) => {
    if (!isOwnExtensionPage(sender, api.runtime.id, api.runtime.getURL(''))) return undefined;
    const message = parseMessage(value);
    if (!message) return undefined;
    void handle(message).then(sendResponse);
    // Keeps the channel open for the asynchronous answer (Chrome does not await a Promise here).
    return true;
  });
}
