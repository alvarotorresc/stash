import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import { RECORDS_PATH, type PushOperation } from '@stash/core/sync-protocol';
import { describe, expect, it } from 'vitest';
import { PURGE_MAX_RECORDS, sweepExpiredRows } from '../src/accounts/sweep';
import worker from '../src/index';
import { call, dataOf, randomKey, register } from './helpers';

function creates(count: number): PushOperation[] {
  return Array.from({ length: count }, () => ({
    op: 'create',
    id: crypto.randomUUID(),
    kind: 'item',
    blob: randomKey(64),
  }));
}

async function accountWith(
  records: number,
): Promise<{ id: string; token: string; loginKey: string }> {
  const { email, token, keys } = await register();
  await dataOf(
    await call(RECORDS_PATH, { method: 'POST', token, body: { operations: creates(records) } }),
  );
  const row = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  return { id: row?.id as string, token, loginKey: keys.loginKey };
}

async function deleteAccount(token: string, loginKey: string): Promise<void> {
  await dataOf(await call(API_PATHS.account, { method: 'DELETE', token, body: { loginKey } }));
}

async function recordsOf(id: string): Promise<number> {
  return (await env.DB.prepare('SELECT count(*) AS n FROM records WHERE user_id = ?')
    .bind(id)
    .first<number>('n')) as number;
}

describe('purge of deleted accounts', () => {
  it('should purge a bounded number of records per sweep until none is left', async () => {
    const gone = await accountWith(5);
    const kept = await accountWith(3);
    await deleteAccount(gone.token, gone.loginKey);
    const now = Date.now();

    const left: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      await sweepExpiredRows(env.DB, now, undefined, 2);
      left.push(await recordsOf(gone.id));
    }

    expect({
      left,
      kept: await recordsOf(kept.id),
      keptCounts: await env.DB.prepare('SELECT records FROM record_counts WHERE user_id = ?')
        .bind(kept.id)
        .first('records'),
      keptPull: (await call(RECORDS_PATH, { token: kept.token })).status,
    }).toEqual({ left: [3, 1, 0], kept: 3, keptCounts: 3, keptPull: 200 });
  });

  it('should spread the purge of several accounts over the same bound', async () => {
    const a = await accountWith(3);
    const b = await accountWith(3);
    await deleteAccount(a.token, a.loginKey);
    await deleteAccount(b.token, b.loginKey);

    await sweepExpiredRows(env.DB, Date.now(), undefined, 4);

    expect((await recordsOf(a.id)) + (await recordsOf(b.id))).toBe(2);
  });

  it('should keep the tombstone of the account after the purge', async () => {
    const gone = await accountWith(1);
    await deleteAccount(gone.token, gone.loginKey);

    await sweepExpiredRows(env.DB, Date.now());

    expect({
      records: await recordsOf(gone.id),
      tombstone: await env.DB.prepare('SELECT count(*) AS n FROM deleted_users WHERE id = ?')
        .bind(gone.id)
        .first('n'),
    }).toEqual({ records: 0, tombstone: 1 });
  });

  it('should purge on the cron trigger', async () => {
    const gone = await accountWith(2);
    await deleteAccount(gone.token, gone.loginKey);

    await worker.scheduled(
      createScheduledController({ cron: '17 4 * * *', scheduledTime: Date.now() }),
      env,
    );

    expect(await recordsOf(gone.id)).toBe(0);
  });

  it('should purge at most a bounded number of records per run by default', () => {
    expect(PURGE_MAX_RECORDS).toBe(1_000);
  });
});
