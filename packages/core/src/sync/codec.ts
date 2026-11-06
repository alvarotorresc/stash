/**
 * Records to encrypted blobs and back.
 *
 * Plaintext format, version 1: `0x01 ‖ u32be(length of the JSON) ‖ JSON ‖ thumbnail bytes`.
 * The JSON holds `{ v: 1, kind, ...fields }`; the record id is not inside, it is bound to the
 * blob by the encryption. The thumbnail goes as raw bytes after the JSON so it is not inflated
 * by base64 twice (once here, once on the wire).
 *
 * The kind inside the plaintext is the authoritative one: the server's `kind` column is only a
 * label it could change, so a record whose two kinds differ is rejected.
 */
import { decryptRecord, encryptRecord, type DataKey } from '../crypto/records';
import { MAX_BLOB_BYTES, MIN_BLOB_BYTES, type RecordKind } from './protocol';
import { SyncError } from './errors';
import {
  parseCategory,
  parseItem,
  parseTag,
  parseThumbnailType,
  type Item,
  type RecordValue,
} from './model';

const FORMAT = 1;
const SCHEMA_VERSION = 1;
const HEADER_BYTES = 5;
/** Largest plaintext whose sealed blob still fits the server's limit. */
export const MAX_PLAINTEXT_BYTES = MAX_BLOB_BYTES - MIN_BLOB_BYTES;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function fieldsOf(record: RecordValue): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...record.value };
  delete fields.id;
  if (record.kind === 'item') {
    delete fields.thumbnail;
    fields.thumbnailType = record.value.thumbnail?.type ?? null;
  }
  return fields;
}

/** Plaintext bytes of a record, before encryption. */
export function encodeRecord(record: RecordValue): Uint8Array<ArrayBuffer> {
  const json = encoder.encode(
    JSON.stringify({ v: SCHEMA_VERSION, kind: record.kind, ...fieldsOf(record) }),
  );
  const thumbnail = record.kind === 'item' ? (record.value.thumbnail?.bytes ?? null) : null;
  const bytes = new Uint8Array(HEADER_BYTES + json.length + (thumbnail?.length ?? 0));
  bytes[0] = FORMAT;
  new DataView(bytes.buffer).setUint32(1, json.length);
  bytes.set(json, HEADER_BYTES);
  if (thumbnail !== null) bytes.set(thumbnail, HEADER_BYTES + json.length);
  return bytes;
}

/** Reads plaintext bytes back into a record with the given id. Throws on anything malformed. */
export function decodeRecord(id: string, bytes: Uint8Array): RecordValue {
  if (bytes.length < HEADER_BYTES || bytes[0] !== FORMAT) throw new Error('Unknown format');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  if (HEADER_BYTES + length > bytes.length) throw new Error('Truncated record');
  const json = JSON.parse(
    decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + length)),
  ) as Record<string, unknown> | null;
  if (typeof json !== 'object' || json === null || json.v !== SCHEMA_VERSION) {
    throw new Error('Unknown schema version');
  }
  const rest = bytes.slice(HEADER_BYTES + length);
  switch (json.kind) {
    case 'item': {
      const type = json.thumbnailType ?? null;
      const thumbnail =
        type === null ? null : { type: parseThumbnailType(type), bytes: new Uint8Array(rest) };
      return { kind: 'item', value: parseItem(id, json, thumbnail) };
    }
    case 'category':
      return { kind: 'category', value: parseCategory(id, json) };
    case 'tag':
      return { kind: 'tag', value: parseTag(id, json) };
    default:
      throw new Error('Unknown kind');
  }
}

/**
 * Shrinks an item until its plaintext fits the server's limit, so a save never fails for being
 * long: first the reader HTML goes (the text stays for search and reading), then the text is
 * cut, then the thumbnail goes. An item that still does not fit (it cannot happen with a valid
 * URL) is a `TOO_LARGE` error.
 */
export function fitItem(item: Item, maxBytes = MAX_PLAINTEXT_BYTES): Item {
  const size = (candidate: Item) => encodeRecord({ kind: 'item', value: candidate }).length;
  let current = item;
  let excess = size(current) - maxBytes;
  if (excess <= 0) return current;

  if (current.content?.html !== undefined) {
    current = { ...current, content: { kind: current.content.kind, text: current.content.text } };
    excess = size(current) - maxBytes;
    if (excess <= 0) return current;
  }
  if (current.content !== null && current.content.text.length > 0) {
    // Each UTF-16 unit takes at least one byte of JSON, so cutting `excess` units is enough.
    let text = current.content.text.slice(0, Math.max(0, current.content.text.length - excess));
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    current = { ...current, content: { ...current.content, text } };
    excess = size(current) - maxBytes;
    if (excess <= 0) return current;
  }
  if (current.thumbnail !== null) {
    current = { ...current, thumbnail: null };
    if (size(current) <= maxBytes) return current;
  }
  throw new SyncError('TOO_LARGE', 'The item does not fit the size limit');
}

/** Encrypts a record for its id: the blob only opens as this record. */
export function sealRecord(
  dataKey: DataKey,
  record: RecordValue,
): Promise<Uint8Array<ArrayBuffer>> {
  return encryptRecord(dataKey, record.value.id, encodeRecord(record));
}

/**
 * Decrypts a blob and checks it holds a record of the expected kind. Throws on tampering, on a
 * blob made for another record or kind, and on anything that does not match the model.
 */
export async function openRecord(
  dataKey: DataKey,
  id: string,
  kind: RecordKind,
  blob: Uint8Array,
): Promise<RecordValue> {
  const record = decodeRecord(id, await decryptRecord(dataKey, id, blob));
  if (record.kind !== kind) throw new Error('Kind does not match');
  return record;
}
