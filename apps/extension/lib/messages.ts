import { toHttpUrl } from './service';

/**
 * Messages between the extension's pages (popup) and the background. Every message received is
 * untrusted input: it is parsed into one of these shapes or dropped.
 */

/** Save a link whose page is not open; the service extracts it through the proxy. */
export interface SaveLinkMessage {
  type: 'save-link';
  url: string;
}

export type Message = SaveLinkMessage;

export type MessageResponse = { ok: true } | { ok: false };

/** Longest URL accepted in a message. */
export const MAX_MESSAGE_URL = 8192;

/** The value as a known message, or null. Extra keys are dropped, not passed on. */
export function parseMessage(value: unknown): Message | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { type, url } = value as Record<string, unknown>;
  if (type !== 'save-link') return null;
  if (typeof url !== 'string' || url.length > MAX_MESSAGE_URL) return null;
  const href = toHttpUrl(url);
  return href ? { type, url: href } : null;
}

/** What the browser says about who sent a message. */
export interface MessageSender {
  id?: string;
  url?: string;
  tab?: unknown;
}

/**
 * True only for the extension's own pages (popup, options). Scripts injected into tabs carry the
 * extension id too, so the sender must also have no tab and an address inside the extension.
 */
export function isOwnExtensionPage(
  sender: MessageSender,
  extensionId: string,
  /** `runtime.getURL('')`, such as "chrome-extension://<id>/". */
  extensionOrigin: string,
): boolean {
  if (!extensionId || sender.id !== extensionId) return false;
  if (sender.tab !== undefined && sender.tab !== null) return false;
  // `URL.origin` is "null" for extension schemes, so compare the base address as text. The base
  // must end in "/" so "chrome-extension://abc" cannot match "chrome-extension://abcd".
  if (typeof sender.url !== 'string' || !extensionOrigin.endsWith('/')) return false;
  return sender.url.startsWith(extensionOrigin);
}
