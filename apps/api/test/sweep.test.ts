import { createScheduledController } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import wranglerToml from '../wrangler.toml?raw';
import { describe, expect, it } from 'vitest';
import { AUTH_BUDGET, LONGEST_WINDOW_MS } from '../src/accounts/rate-limit';
import { SWEEP_MAX_ROWS, sweepExpiredRows } from '../src/accounts/sweep';
import worker from '../src/index';
import { register } from './helpers';

async function seed(now: number): Promise<void> {
  await register();
  const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    ).bind('expired', userId, now - 1, now - 10),
    env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)').bind(
      'dead',
      now - LONGEST_WINDOW_MS,
    ),
    env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)').bind(
      'live',
      now - LONGEST_WINDOW_MS + 1,
    ),
  ]);
}

async function left(): Promise<{ sessions: string[]; counters: string[] }> {
  const sessions = await env.DB.prepare('SELECT token_hash FROM sessions').all<{
    token_hash: string;
  }>();
  const counters = await env.DB.prepare(
    "SELECT key FROM rate_limits WHERE key IN ('dead', 'live') ORDER BY key",
  ).all<{
    key: string;
  }>();
  return {
    sessions: sessions.results.map((row) => (row.token_hash === 'expired' ? 'expired' : 'live')),
    counters: counters.results.map((row) => row.key),
  };
}

describe('sweepExpiredRows', () => {
  it('should delete expired sessions and dead counters and keep the rest', async () => {
    const now = Date.now();
    await seed(now);

    await sweepExpiredRows(env.DB, now);

    expect(await left()).toEqual({ sessions: ['live'], counters: ['live'] });
  });
});

describe('bounded sweep', () => {
  async function seedDead(now: number, count: number): Promise<void> {
    await register();
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;
    const statements = [];
    for (let i = 0; i < count; i++) {
      statements.push(
        env.DB.prepare(
          'INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
        ).bind(`expired-${i}`, userId, now - 1, now - 10),
        env.DB.prepare('INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)').bind(
          `dead-${i}`,
          now - LONGEST_WINDOW_MS,
        ),
      );
    }
    await env.DB.batch(statements);
  }

  async function count(sql: string): Promise<unknown> {
    return env.DB.prepare(sql).first('n');
  }

  it('should delete at most the given number of rows per table in one run', async () => {
    const now = Date.now();
    await seedDead(now, 5);

    await sweepExpiredRows(env.DB, now, 3);

    expect({
      sessions: await count("SELECT count(*) AS n FROM sessions WHERE token_hash LIKE 'expired-%'"),
      counters: await count("SELECT count(*) AS n FROM rate_limits WHERE key LIKE 'dead-%'"),
    }).toEqual({ sessions: 2, counters: 2 });
  });

  it('should keep a daily bound above the rows a day of requests can leave behind', () => {
    // At most one session and a few new counter keys per budgeted request, so a table never
    // grows faster than a run can sweep it.
    expect(SWEEP_MAX_ROWS).toBeGreaterThanOrEqual(4 * AUTH_BUDGET.max);
  });
});

describe('scheduled handler', () => {
  it('should sweep on the cron trigger', async () => {
    const now = Date.now();
    await seed(now);

    await worker.scheduled(
      createScheduledController({ cron: '17 4 * * *', scheduledTime: now }),
      env,
    );

    expect(await left()).toEqual({ sessions: ['live'], counters: ['live'] });
  });

  it('should be scheduled once a day', () => {
    expect(wranglerToml).toMatch(/\[triggers\]\s*\ncrons = \["17 4 \* \* \*"\]/);
  });
});

describe('new sessions', () => {
  it('should leave the sweep to the schedule', async () => {
    const now = Date.now();
    await seed(now);

    await register();

    expect((await left()).sessions).toContain('expired');
  });
});
