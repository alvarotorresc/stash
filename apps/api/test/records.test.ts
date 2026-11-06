import { env } from 'cloudflare:workers';
import { API_PATHS, toBase64Url } from '@stash/core/protocol';
import {
  MAX_BLOB_BYTES,
  MAX_BYTES_PER_ACCOUNT,
  MAX_PULL_LIMIT,
  MAX_PULL_PAGE_BYTES,
  MAX_PUSH_BODY_BYTES,
  MAX_PUSH_RECORDS,
  MAX_RECORDS_PER_ACCOUNT,
  RECORDS_PATH,
  type PullMeta,
  type PushOperation,
  type PushResponse,
  type WireRecord,
} from '@stash/core/sync-protocol';
import { describe, expect, it } from 'vitest';
import { hmac } from '../src/accounts/hashing';
import { LIMITS } from '../src/accounts/rate-limit';
import { readPush, type ParsedOperation } from '../src/records/validation';
import { CREATE, PUT } from '../src/records/routes';
import { pushWeight } from '../src/records/weight';
import { call, dataOf, errorOf, randomKey, register } from './helpers';

/** A random-looking base64url blob of `bytes` decoded bytes (getRandomValues caps at 64 KiB). */
function blob(bytes = 64): string {
  if (bytes <= 65_536) return randomKey(bytes);
  const length = Math.ceil((bytes * 4) / 3);
  return (randomKey(32) + 'A'.repeat(length)).slice(0, length);
}

function create(
  kind: PushOperation['kind'] = 'item',
  value = blob(),
): Extract<PushOperation, { op: 'create' | 'put' }> {
  return { op: 'create', id: crypto.randomUUID(), kind, blob: value };
}

function pushRaw(token: string | undefined, body: unknown): Promise<Response> {
  return call(RECORDS_PATH, { method: 'POST', token, body });
}

async function push(token: string, operations: PushOperation[]): Promise<PushResponse> {
  return dataOf<PushResponse>(await pushRaw(token, { operations }));
}

async function pull(token: string, query = ''): Promise<{ records: WireRecord[]; meta: PullMeta }> {
  const response = await call(`${RECORDS_PATH}${query}`, { token });
  const json = (await response.json()) as { data: WireRecord[]; meta: PullMeta };
  expect(response.status, JSON.stringify(json)).toBe(200);
  return { records: json.data, meta: json.meta };
}

async function pullAll(
  token: string,
  cursor = '0',
): Promise<{ records: WireRecord[]; cursor: string }> {
  const records: WireRecord[] = [];
  let next = cursor;
  for (;;) {
    const page = await pull(token, `?cursor=${next}`);
    records.push(...page.records);
    next = page.meta.nextCursor;
    if (!page.meta.hasMore) return { records, cursor: next };
  }
}

/** Operations as the route parses them. */
function parse(operations: PushOperation[]): Promise<ParsedOperation[]> {
  return readPush(
    new Request('https://stash.test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations }),
    }),
  );
}

async function countsOf(token: string): Promise<{ records: number; bytes: number } | null> {
  const userId = await userIdOf(token);
  return env.DB.prepare('SELECT records, bytes FROM record_counts WHERE user_id = ?')
    .bind(userId)
    .first<{ records: number; bytes: number }>();
}

async function userIdOf(token: string): Promise<string> {
  const { email } = await dataOf<{ email: string }>(await call(API_PATHS.account, { token }));
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  return row?.id as string;
}

async function setCounts(token: string, records: number, bytes: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO record_counts (user_id, records, bytes) VALUES (?1, ?2, ?3)
     ON CONFLICT (user_id) DO UPDATE SET records = ?2, bytes = ?3`,
  )
    .bind(await userIdOf(token), records, bytes)
    .run();
}

describe('/api/records', () => {
  describe('authentication', () => {
    it('should answer 401 without a session', async () => {
      expect({
        get: await errorOf(await call(RECORDS_PATH)),
        post: await errorOf(await pushRaw(undefined, { operations: [create()] })),
      }).toEqual({
        get: { status: 401, code: 'UNAUTHORIZED' },
        post: { status: 401, code: 'UNAUTHORIZED' },
      });
    });

    it('should answer 405 with Allow for other methods', async () => {
      const response = await call(RECORDS_PATH, { method: 'PUT', body: {} });

      expect({ ...(await errorOf(response)), allow: response.headers.get('Allow') }).toEqual({
        status: 405,
        code: 'METHOD_NOT_ALLOWED',
        allow: 'GET, POST',
      });
    });
  });

  describe('push and pull', () => {
    it('should store created records and return them in version order', async () => {
      const { token } = await register();
      const item = create('item');
      const category = create('category');

      const { results } = await push(token, [item, category]);
      const { records, meta } = await pull(token);

      expect({ results, records, meta }).toEqual({
        results: [
          { id: item.id, applied: true, version: 1 },
          { id: category.id, applied: true, version: 2 },
        ],
        records: [
          { id: item.id, kind: 'item', version: 1, deleted: false, blob: item.blob },
          { id: category.id, kind: 'category', version: 2, deleted: false, blob: category.blob },
        ],
        meta: { nextCursor: '2', hasMore: false },
      });
    });

    it('should not duplicate a retried create', async () => {
      const { token } = await register();
      const item = create();

      await push(token, [item]);
      const retry = await push(token, [item]);
      const { records } = await pull(token);

      expect({ retry: retry.results, rows: records.length, counts: await countsOf(token) }).toEqual(
        {
          retry: [{ id: item.id, applied: false, version: 1 }],
          rows: 1,
          counts: { records: 1, bytes: 64 },
        },
      );
    });

    it('should not let a retried create overwrite a later edit', async () => {
      const { token } = await register();
      const item = create();
      const edited = blob();
      await push(token, [item]);
      await push(token, [{ op: 'put', id: item.id, kind: 'item', blob: edited }]);

      await push(token, [item]);
      const { records } = await pull(token);

      expect(records).toEqual([
        { id: item.id, kind: 'item', version: 2, deleted: false, blob: edited },
      ]);
    });

    it('should apply the last put and keep the version when the same blob is sent again', async () => {
      const { token } = await register();
      const item = create();
      const first = blob();
      const second = blob(80);
      await push(token, [item]);

      const a = await push(token, [{ op: 'put', id: item.id, kind: 'item', blob: first }]);
      const b = await push(token, [{ op: 'put', id: item.id, kind: 'item', blob: second }]);
      const again = await push(token, [{ op: 'put', id: item.id, kind: 'item', blob: second }]);
      const { records } = await pull(token);

      expect({
        versions: [a.results[0], b.results[0], again.results[0]],
        blob: records[0]?.blob,
        counts: await countsOf(token),
      }).toEqual({
        versions: [
          { id: item.id, applied: true, version: 2 },
          { id: item.id, applied: true, version: 3 },
          { id: item.id, applied: false, version: 3 },
        ],
        blob: second,
        counts: { records: 1, bytes: 80 },
      });
    });

    it('should create a record with put when the id is new', async () => {
      const { token } = await register();
      const id = crypto.randomUUID();

      const { results } = await push(token, [{ op: 'put', id, kind: 'tag', blob: blob() }]);

      expect(results).toEqual([{ id, applied: true, version: 1 }]);
    });

    it('should pull only the changes after the cursor', async () => {
      const { token } = await register();
      const a = create();
      const b = create();
      await push(token, [a]);
      const { meta } = await pull(token);

      await push(token, [b, { op: 'put', id: a.id, kind: 'item', blob: blob() }]);
      const { records } = await pull(token, `?cursor=${meta.nextCursor}`);

      expect(records.map(({ id, version }) => ({ id, version }))).toEqual([
        { id: b.id, version: 2 },
        { id: a.id, version: 3 },
      ]);
    });

    it('should give an empty account a cursor of 0', async () => {
      const { token } = await register();

      expect(await pull(token)).toEqual({
        records: [],
        meta: { nextCursor: '0', hasMore: false },
      });
    });
  });

  describe('logical delete', () => {
    it('should leave a tombstone without the blob and pull it after a cursor', async () => {
      const { token } = await register();
      const item = create();
      await push(token, [item]);
      const { meta } = await pull(token);

      const { results } = await push(token, [{ op: 'delete', id: item.id, kind: 'item' }]);
      const changes = await pull(token, `?cursor=${meta.nextCursor}`);
      const row = await env.DB.prepare('SELECT deleted, blob, size FROM records WHERE id = ?')
        .bind(item.id)
        .first();

      expect({ results, changes: changes.records, row, counts: await countsOf(token) }).toEqual({
        results: [{ id: item.id, applied: true, version: 2 }],
        changes: [{ id: item.id, kind: 'item', version: 2, deleted: true, blob: null }],
        row: { deleted: 1, blob: null, size: 0 },
        counts: { records: 1, bytes: 0 },
      });
    });

    it('should leave tombstones out of a first load and move the cursor past them', async () => {
      const { token } = await register();
      const kept = create();
      const gone = create();
      await push(token, [kept, gone]);
      await push(token, [{ op: 'delete', id: gone.id, kind: 'item' }]);

      const { records, meta } = await pull(token);

      expect({ ids: records.map(({ id }) => id), meta }).toEqual({
        ids: [kept.id],
        meta: { nextCursor: '3', hasMore: false },
      });
    });

    it('should change nothing when deleting an unknown or deleted record', async () => {
      const { token } = await register();
      const item = create();
      await push(token, [item]);
      await push(token, [{ op: 'delete', id: item.id, kind: 'item' }]);
      const unknown = crypto.randomUUID();

      const { results } = await push(token, [
        { op: 'delete', id: item.id, kind: 'item' },
        { op: 'delete', id: unknown, kind: 'item' },
      ]);

      expect(results).toEqual([
        { id: item.id, applied: false, version: 2 },
        { id: unknown, applied: false, version: null },
      ]);
    });

    it('should bring a deleted record back with put (undo)', async () => {
      const { token } = await register();
      const item = create();
      await push(token, [item]);
      await push(token, [{ op: 'delete', id: item.id, kind: 'item' }]);

      await push(token, [{ op: 'put', id: item.id, kind: 'item', blob: item.blob }]);
      const { records } = await pull(token);

      expect(records).toEqual([
        { id: item.id, kind: 'item', version: 3, deleted: false, blob: item.blob },
      ]);
    });

    it('should not bring a deleted record back with a retried create', async () => {
      const { token } = await register();
      const item = create();
      await push(token, [item]);
      await push(token, [{ op: 'delete', id: item.id, kind: 'item' }]);

      const { results } = await push(token, [item]);
      const { records } = await pull(token);

      expect({ results, records }).toEqual({
        results: [{ id: item.id, applied: false, version: 2 }],
        records: [],
      });
    });

    it('should refuse to change the kind of a record', async () => {
      const { token } = await register();
      const item = create('item');
      await push(token, [item]);

      const response = await pushRaw(token, {
        operations: [{ op: 'put', id: item.id, kind: 'tag', blob: blob() }],
      });

      expect(await errorOf(response)).toEqual({ status: 409, code: 'CONFLICT' });
    });
  });

  describe('pagination', () => {
    it('should page by the requested limit and continue from the cursor', async () => {
      const { token } = await register();
      const operations = Array.from({ length: 5 }, () => create());
      await push(token, operations);

      const first = await pull(token, '?limit=2');
      const second = await pull(token, `?cursor=${first.meta.nextCursor}&limit=2`);
      const third = await pull(token, `?cursor=${second.meta.nextCursor}&limit=2`);

      expect({
        pages: [first, second, third].map(({ records, meta }) => ({
          versions: records.map(({ version }) => version),
          meta,
        })),
      }).toEqual({
        pages: [
          { versions: [1, 2], meta: { nextCursor: '2', hasMore: true } },
          { versions: [3, 4], meta: { nextCursor: '4', hasMore: true } },
          { versions: [5], meta: { nextCursor: '5', hasMore: false } },
        ],
      });
    });

    it('should cap the limit at the maximum page size', async () => {
      const { token } = await register();
      for (let batch = 0; batch < 6; batch += 1) {
        await push(
          token,
          Array.from({ length: MAX_PUSH_RECORDS }, () => create('item', blob(29))),
        );
      }

      const { records, meta } = await pull(token, '?limit=100000');

      expect({ count: records.length, hasMore: meta.hasMore }).toEqual({
        count: MAX_PULL_LIMIT,
        hasMore: true,
      });
    });

    it('should cut a page by blob bytes but always return one record', async () => {
      const { token } = await register();
      const big = MAX_BLOB_BYTES;
      // Pushed one by one: each push body stays under its own limit.
      for (let index = 0; index < 4; index += 1) await push(token, [create('item', blob(big))]);

      const first = await pull(token);
      const all = await pullAll(token);

      expect({
        firstPage: first.records.length,
        firstFits: first.records.length * big <= MAX_PULL_PAGE_BYTES,
        hasMore: first.meta.hasMore,
        total: all.records.length,
      }).toEqual({
        firstPage: Math.floor(MAX_PULL_PAGE_BYTES / big),
        firstFits: true,
        hasMore: true,
        total: 4,
      });
    });
  });

  describe('isolation between accounts', () => {
    it('should never show one account the records of another', async () => {
      const a = await register();
      const b = await register();
      await push(a.token, [create()]);

      expect((await pullAll(b.token)).records).toEqual([]);
    });

    it('should keep the same id in two accounts as two separate records', async () => {
      const a = await register();
      const b = await register();
      const item = create();
      await push(a.token, [item]);

      const bWrite = await push(b.token, [{ ...item, blob: blob() }]);
      const bDelete = await push(b.token, [{ op: 'delete', id: item.id, kind: 'item' }]);
      const aRecords = (await pull(a.token)).records;

      expect({ bWrite: bWrite.results[0]?.applied, bDelete: bDelete.results[0], aRecords }).toEqual(
        {
          bWrite: true,
          bDelete: { id: item.id, applied: true, version: 2 },
          aRecords: [{ id: item.id, kind: 'item', version: 1, deleted: false, blob: item.blob }],
        },
      );
    });

    it('should number versions per account', async () => {
      const a = await register();
      const b = await register();
      await push(a.token, [create(), create()]);

      const { results } = await push(b.token, [create()]);

      expect(results[0]?.version).toBe(1);
    });
  });

  describe('account deletion', () => {
    async function deleteAccount(token: string, loginKey: string): Promise<void> {
      await dataOf(await call(API_PATHS.account, { method: 'DELETE', token, body: { loginKey } }));
    }

    it('should make the records unreachable at once and leave them encrypted for the purge', async () => {
      const a = await register();
      const b = await register();
      const sent = [create(), create()];
      await push(a.token, sent);
      await push(b.token, [create()]);
      const aId = await userIdOf(a.token);

      await deleteAccount(a.token, a.keys.loginKey);
      const { results } = await env.DB.prepare(
        'SELECT blob FROM records WHERE user_id = ? ORDER BY version',
      )
        .bind(aId)
        .all<{ blob: string }>();
      const left = await env.DB.prepare(
        `SELECT (SELECT count(*) FROM record_counts WHERE user_id = ?1) AS counts,
                (SELECT count(*) FROM users WHERE id = ?1) AS users,
                (SELECT count(*) FROM deleted_users WHERE id = ?1) AS tombstones`,
      )
        .bind(aId)
        .first();

      expect({
        pull: (await call(RECORDS_PATH, { token: a.token })).status,
        push: (await pushRaw(a.token, { operations: [create()] })).status,
        // The device's ciphertext, as sent: its data key was only wrapped in the deleted user.
        pending: results.map(({ blob }) => blob),
        left,
        b: (await pull(b.token)).records.length,
      }).toEqual({
        pull: 401,
        push: 401,
        pending: sent.map(({ blob }) => blob),
        left: { counts: 0, users: 0, tombstones: 1 },
        b: 1,
      });
    });

    it('should never give the id of a deleted account to a new account', async () => {
      const { token, keys } = await register();
      const id = await userIdOf(token);
      await deleteAccount(token, keys.loginKey);

      const reuse = env.DB.prepare(
        `INSERT INTO users (id, email, salt, kdf_memory_kib, kdf_iterations, kdf_parallelism,
           login_key_hash, recovery_key_hash, wrapped_data_key, recovery_wrapped_data_key,
           created_at, updated_at)
         VALUES (?, 'reuse@example.com', 's', 1, 1, 1, 'l', 'r', 'w', 'rw', 0, 0)`,
      )
        .bind(id)
        .run();

      await expect(reuse).rejects.toThrow(/deleted account/);
    });

    it('should refuse records for an account that does not exist', async () => {
      const { token, keys } = await register();
      const id = await userIdOf(token);
      await deleteAccount(token, keys.loginKey);

      // A push that passed its session check just before the deletion committed.
      const late = env.DB.prepare(CREATE)
        .bind(id, crypto.randomUUID(), 'item', blob(), 64, 0)
        .run();

      await expect(late).rejects.toThrow(/no account/);
    });

    it('should refuse a late put on a record the deleted account already had', async () => {
      const { token, keys } = await register();
      const id = await userIdOf(token);
      const kept = create();
      await push(token, [kept]);
      await deleteAccount(token, keys.loginKey);

      const late = env.DB.prepare(PUT).bind(id, kept.id, 'item', blob(), 64, 0).run();

      await expect(late).rejects.toThrow(/no account/);
    });

    it('should enforce foreign keys', async () => {
      expect(await env.DB.prepare('PRAGMA foreign_keys').first('foreign_keys')).toBe(1);
    });
  });

  describe('validation', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const cases: [string, unknown][] = [
      ['a body that is not JSON', 'not json'],
      ['a missing operations array', {}],
      ['an empty operations array', { operations: [] }],
      ['an operation that is not an object', { operations: ['x'] }],
      [
        'an id that is not a UUID',
        { operations: [{ op: 'create', id: 'item-1', kind: 'item', blob: blob() }] },
      ],
      [
        'an uppercase id',
        {
          operations: [
            {
              op: 'create',
              id: 'ABCDEF00-0000-4000-8000-000000000000',
              kind: 'item',
              blob: blob(),
            },
          ],
        },
      ],
      ['an unknown kind', { operations: [{ op: 'create', id, kind: 'note', blob: blob() }] }],
      ['an unknown op', { operations: [{ op: 'upsert', id, kind: 'item', blob: blob() }] }],
      ['a blob on a delete', { operations: [{ op: 'delete', id, kind: 'item', blob: blob() }] }],
      ['a missing blob', { operations: [{ op: 'put', id, kind: 'item' }] }],
      [
        'a blob that is not base64url',
        { operations: [{ op: 'put', id, kind: 'item', blob: 'a+b/c=' }] },
      ],
      [
        'a blob of impossible length',
        { operations: [{ op: 'put', id, kind: 'item', blob: 'a'.repeat(41) }] },
      ],
      [
        'a blob shorter than any sealed value',
        { operations: [{ op: 'put', id, kind: 'item', blob: blob(28) }] },
      ],
      [
        'the same id twice',
        {
          operations: [
            { op: 'put', id, kind: 'item', blob: blob() },
            { op: 'delete', id, kind: 'item' },
          ],
        },
      ],
      [
        'too many operations',
        { operations: Array.from({ length: MAX_PUSH_RECORDS + 1 }, () => create()) },
      ],
    ];

    it.each(cases)('should reject %s with 400', async (_name, body) => {
      const { token } = await register();

      expect(await errorOf(await pushRaw(token, body))).toEqual({
        status: 400,
        code: 'VALIDATION_ERROR',
      });
    });

    it('should reject a blob over the maximum size with 413', async () => {
      const { token } = await register();

      const response = await pushRaw(token, {
        operations: [create('item', blob(MAX_BLOB_BYTES + 1))],
      });

      expect(await errorOf(response)).toEqual({ status: 413, code: 'PAYLOAD_TOO_LARGE' });
    });

    it('should reject a body over the maximum size with 413', async () => {
      const { token } = await register();
      const operations = Array.from({ length: 4 }, () => create('item', blob(MAX_BLOB_BYTES)));

      const response = await pushRaw(token, { operations });

      expect({
        sent: JSON.stringify({ operations }).length > MAX_PUSH_BODY_BYTES,
        error: await errorOf(response),
      }).toEqual({ sent: true, error: { status: 413, code: 'PAYLOAD_TOO_LARGE' } });
    });

    it('should reject a body that is not JSON with 415', async () => {
      const { token } = await register();

      const response = await call(RECORDS_PATH, {
        method: 'POST',
        token,
        headers: { 'Content-Type': 'text/plain' },
      });

      expect(await errorOf(response)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
    });

    it('should not count a refused body in the rate limit', async () => {
      const { token } = await register();
      const counters = () =>
        env.DB.prepare(
          'SELECT count(*) AS n, coalesce(sum(count), 0) AS hits FROM rate_limits',
        ).first<{ n: number; hits: number }>();
      const before = await counters();

      const statuses = [
        (
          await call(RECORDS_PATH, {
            method: 'POST',
            token,
            headers: { 'Content-Type': 'text/plain' },
          })
        ).status,
        (await pushRaw(token, { operations: [] })).status,
        (await pushRaw(token, { operations: [create('item', blob(MAX_BLOB_BYTES + 1))] })).status,
      ];

      expect({ statuses, counters: await counters() }).toEqual({
        statuses: [415, 400, 413],
        counters: before,
      });
    });

    it.each(['?cursor=-1', '?cursor=abc', '?cursor=01', '?limit=0', '?limit=x', '?since=3'])(
      'should reject the query %s with 400',
      async (query) => {
        const { token } = await register();

        expect(await errorOf(await call(`${RECORDS_PATH}${query}`, { token }))).toEqual({
          status: 400,
          code: 'VALIDATION_ERROR',
        });
      },
    );

    it('should store nothing when any operation is invalid', async () => {
      const { token } = await register();

      await pushRaw(token, { operations: [create(), { op: 'create', id: 'bad', kind: 'item' }] });

      expect((await pull(token)).records).toEqual([]);
    });
  });

  describe('quotas', () => {
    it('should keep at most 5000 records and 25 MiB per account', () => {
      expect({ records: MAX_RECORDS_PER_ACCOUNT, bytes: MAX_BYTES_PER_ACCOUNT }).toEqual({
        records: 5_000,
        bytes: 25 * 1024 * 1024,
      });
    });

    it('should refuse new records over the per-account count', async () => {
      const { token } = await register();
      await setCounts(token, MAX_RECORDS_PER_ACCOUNT - 1, 0);

      const response = await pushRaw(token, { operations: [create(), create()] });

      expect(await errorOf(response)).toEqual({ status: 413, code: 'QUOTA_EXCEEDED' });
    });

    it('should refuse blobs over the per-account bytes', async () => {
      const { token } = await register();
      await setCounts(token, 0, MAX_BYTES_PER_ACCOUNT - 100);

      const response = await pushRaw(token, { operations: [create('item', blob(101))] });

      expect(await errorOf(response)).toEqual({ status: 413, code: 'QUOTA_EXCEEDED' });
    });

    it('should still accept deletes and smaller blobs on a full account', async () => {
      const { token } = await register();
      const a = create('item', blob(200));
      const b = create('item', blob(200));
      await push(token, [a, b]);
      await setCounts(token, MAX_RECORDS_PER_ACCOUNT + 5, MAX_BYTES_PER_ACCOUNT + 5);

      const { results } = await push(token, [
        { op: 'delete', id: a.id, kind: 'item' },
        { op: 'put', id: b.id, kind: 'item', blob: blob(100) },
      ]);

      expect(results.map(({ applied }) => applied)).toEqual([true, true]);
    });

    it('should keep the counters exact through creates, edits and deletes', async () => {
      const { token } = await register();
      const a = create('item', blob(100));
      const b = create('item', blob(50));
      await push(token, [a, b]);

      await push(token, [
        { op: 'put', id: a.id, kind: 'item', blob: blob(300) },
        { op: 'delete', id: b.id, kind: 'item' },
      ]);

      expect(await countsOf(token)).toEqual({ records: 2, bytes: 300 });
    });
  });

  describe('rate limiting', () => {
    async function counterKey(action: string, bucket: string, subject: string): Promise<string> {
      return toBase64Url(
        await hmac(env.PEPPER, 'rate-limit', `${action}\u0000${bucket}\u0000${subject}`),
      );
    }

    async function countOf(key: string): Promise<number | null> {
      const row = await env.DB.prepare('SELECT count FROM rate_limits WHERE key = ?')
        .bind(key)
        .first<{ count: number }>();
      return row?.count ?? null;
    }

    async function fill(key: string, count: number): Promise<void> {
      await env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, ?)')
        .bind(key, Date.now(), count)
        .run();
    }

    it('should count pulls per account and answer 429 over the limit', async () => {
      const { token } = await register();
      for (let index = 0; index < LIMITS.recordsPull.account.max; index += 1) {
        await call(RECORDS_PATH, { token });
      }

      const pulled = await call(RECORDS_PATH, { token });
      const pushed = await pushRaw(token, { operations: [create()] });

      expect({
        pulled: await errorOf(pulled),
        retryAfter: Number(pulled.headers.get('Retry-After')) > 0,
        pushed: pushed.status,
      }).toEqual({ pulled: { status: 429, code: 'RATE_LIMITED' }, retryAfter: true, pushed: 200 });
    });

    it('should count a push by the weight of its operations', async () => {
      const { token } = await register();
      const key = await counterKey('recordsPush', 'account', await userIdOf(token));
      const global = await counterKey('recordsPush', 'global', '');
      const a = create();
      const b = create();
      await push(token, [a, b]);
      const afterCreates = { account: await countOf(key), global: await countOf(global) };
      const edits: PushOperation[] = [
        { op: 'put', id: a.id, kind: 'item', blob: blob() },
        { op: 'delete', id: b.id, kind: 'item' },
      ];

      await push(token, edits);
      await push(token, [{ op: 'delete', id: a.id, kind: 'item' }]);

      expect({
        afterCreates,
        account: await countOf(key),
        global: await countOf(global),
        weights: [pushWeight(await parse([a, b])), pushWeight(await parse(edits))],
      }).toEqual({
        // Request 3, a new record 4 each, the possible first record of the account 1.
        afterCreates: { account: 12, global: 12 },
        // Then a put (charged as a possible insert) and a delete, and a lone delete.
        account: 12 + 11 + 6,
        global: 12 + 11 + 6,
        weights: [12, 11],
      });
    });

    it('should accept a push that fills the account bucket exactly', async () => {
      const { token } = await register();
      const key = await counterKey('recordsPush', 'account', await userIdOf(token));
      const operations = [create()];
      await fill(key, LIMITS.recordsPush.account.max - pushWeight(await parse(operations)));

      await push(token, operations);

      expect(await countOf(key)).toBe(LIMITS.recordsPush.account.max);
    });

    it('should refuse a push over the account bucket, write nothing and keep pulls open', async () => {
      const { token } = await register();
      const key = await counterKey('recordsPush', 'account', await userIdOf(token));
      const operations = [create()];
      const before = LIMITS.recordsPush.account.max - pushWeight(await parse(operations)) + 1;
      await fill(key, before);

      const pushed = await pushRaw(token, { operations });
      const pulled = await pull(token);

      expect({
        pushed: await errorOf(pushed),
        account: await countOf(key),
        global: await countOf(await counterKey('recordsPush', 'global', '')),
        stored: pulled.records.length,
      }).toEqual({
        pushed: { status: 429, code: 'RATE_LIMITED' },
        account: before,
        global: null,
        stored: 0,
      });
    });

    it('should cap the weight of every push together in a day', async () => {
      const operations = [create()];
      const global = await counterKey('recordsPush', 'global', '');
      await fill(global, LIMITS.recordsPush.global.max - pushWeight(await parse(operations)) + 1);
      const { token } = await register();

      expect(await errorOf(await pushRaw(token, { operations }))).toEqual({
        status: 429,
        code: 'RATE_LIMITED',
      });
    });

    it('should keep the heaviest push under every push limit', async () => {
      const operations = Array.from({ length: MAX_PUSH_RECORDS }, () => create());
      const weight = pushWeight(await parse(operations));

      expect({
        weight,
        account: weight <= LIMITS.recordsPush.account.max,
        global: weight <= LIMITS.recordsPush.global.max,
      }).toEqual({ weight: 3 + MAX_PUSH_RECORDS * 4 + 1, account: true, global: true });
    });
  });

  describe('failures', () => {
    it('should answer a generic 500 when the database fails', async () => {
      const { token } = await register();
      await env.DB.prepare('DROP TABLE record_counts').run();

      expect(await errorOf(await pushRaw(token, { operations: [create()] }))).toEqual({
        status: 500,
        code: 'INTERNAL_ERROR',
      });
    });
  });
});
