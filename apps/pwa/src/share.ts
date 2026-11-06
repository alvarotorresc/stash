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
const TRAILING = /[.,;:!?\]}»”’]+$/;

/** Strips sentence punctuation and any ")" the link itself did not open. */
function trimTrailing(link: string): string {
  let result = link.replace(TRAILING, '');
  const count = (char: string) => result.split(char).length - 1;
  while (result.endsWith(')') && count(')') > count('(')) {
    result = result.slice(0, -1).replace(TRAILING, '');
  }
  return result;
}

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
 *
 * When text carries several links only the first is kept: apps put the
 * shared item first and append their own links (profile, download) after.
 * Stash saves one item per share, so it never guesses among the rest.
 */
export function extractSharedUrl(fields: { url?: string | null; text?: string | null }) {
  const direct = toHttpUrl(fields.url);
  if (direct) return direct;
  const match = URL_IN_TEXT.exec(fields.text ?? '');
  // Too long to be valid anyway; checked first so trimming stays cheap.
  if (!match || match[0].length > MAX_LENGTH) return null;
  return toHttpUrl(trimTrailing(match[0]));
}

const asString = (value: FormDataEntryValue | null) => (typeof value === 'string' ? value : null);

/** Where the app opens after a share: the link in the query, or the start. */
export function shareRedirect(url: string | null, origin: string): string {
  const target = new URL('/', origin);
  if (url) target.searchParams.set(SHARE_PARAM, url);
  return target.href;
}

/** Whether the service worker must answer this request as a share. */
export function isShareRequest(request: Request, origin: string): boolean {
  const url = new URL(request.url);
  return request.method === 'POST' && url.origin === origin && url.pathname === SHARE_PATH;
}

/**
 * POST from the share sheet to a 303 into the app. The redirect always goes
 * to this origin's start page: the shared value only travels as a query
 * parameter, never as the target, so it cannot become an open redirect.
 */
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
