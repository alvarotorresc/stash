/**
 * Android share target. The system POSTs title, text and url to SHARE_PATH;
 * the service worker turns that into a redirect to the app with the link in
 * SHARE_PARAM. Everything that arrives here is untrusted input.
 *
 * Used by the service worker as well: no DOM types.
 */

export const SHARE_PATH = '/share';
export const SHARE_PARAM = 'share';

const MAX_LENGTH = 2048;
const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/i;
/** Punctuation that closes a sentence after a link, not part of it. */
const TRAILING = /[.,;:!?)\]}»”’]+$/;

/** The value as an http(s) URL, or null. */
export function toHttpUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.length > MAX_LENGTH) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/**
 * The shared link: the url field when it is valid, otherwise the first
 * http(s) link inside text (many apps send "Look at this https://…").
 */
export function extractSharedUrl(fields: { url?: string | null; text?: string | null }) {
  const direct = toHttpUrl(fields.url);
  if (direct) return direct;
  const match = URL_IN_TEXT.exec(fields.text ?? '');
  return match ? toHttpUrl(match[0].replace(TRAILING, '')) : null;
}

const asString = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : null);

/** Where the app opens after a share: the link in the query, or the start. */
export function shareRedirect(url: string | null, origin: string): string {
  const target = new URL('/', origin);
  if (url) target.searchParams.set(SHARE_PARAM, url);
  return target.href;
}

/** POST from the share sheet to a 303 into the app. */
export async function handleShareRequest(request: Request, origin: string): Promise<Response> {
  let url: string | null;
  try {
    const form = await request.formData();
    url = extractSharedUrl({ url: asString(form.get('url')), text: asString(form.get('text')) });
  } catch {
    url = null;
  }
  return new Response(null, { status: 303, headers: { Location: shareRedirect(url, origin) } });
}

/** The shared link from the app's address, validated again, or null. */
export function readSharedParam(search: string): string | null {
  return toHttpUrl(new URLSearchParams(search).get(SHARE_PARAM));
}
