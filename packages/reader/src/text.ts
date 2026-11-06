/**
 * Control characters (C0, DEL, C1) and bidi controls (U+061C, U+200E/F, U+202A–U+202E,
 * U+2066–U+2069). Bidi controls let untrusted text read differently from what it is
 * ("invoice‮fdp.exe" shows as "invoiceexe.pdf"). Joiners (U+200C/D) are kept: emoji and
 * several scripts need them.
 */
const UNSAFE_CHARACTERS = /[\p{Cc}\p{Bidi_Control}]/gu;

/** Collapses whitespace inside lines, removes control and bidi characters and drops empty lines. */
export function normalizeText(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.replace(/\s+/g, ' ').replace(UNSAFE_CHARACTERS, '').replace(/ +/g, ' ').trim(),
    )
    .filter((line) => line.length > 0)
    .join('\n');
}

/** Caps `text` at `max` UTF-16 units, ellipsis included, without splitting a surrogate pair. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
  return `${text.slice(0, cut).trimEnd()}…`;
}
