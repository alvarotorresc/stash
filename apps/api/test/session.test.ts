import { describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
import { createSessionResolver, requireSession, type Session } from '../src/auth/session';
import { register } from './helpers';

const request = () =>
  new Request('https://stash.test/api/private', { headers: { Authorization: 'Bearer anything' } });

describe('requireSession', () => {
  it('should answer 401 and skip the handler when there is no session', async () => {
    const handler = vi.fn(async () => new Response('secret'));

    const res = await requireSession(async () => null, handler)(request());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should hand the session to the handler', async () => {
    const session: Session = { accountId: 'account-1' };
    const handler = vi.fn(async (_req: Request, s: Session) => new Response(s.accountId));

    const res = await requireSession(async () => session, handler)(request());

    expect(await res.text()).toBe('account-1');
    expect(handler).toHaveBeenCalledWith(expect.any(Request), session);
  });

  it('should answer the json 500 envelope and skip the handler when resolving throws', async () => {
    const handler = vi.fn(async () => new Response('secret'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await requireSession(async () => {
      throw new Error('token store down');
    }, handler)(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal error' },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain('token store down');
    error.mockRestore();
  });
});

describe('createSessionResolver', () => {
  it('should resolve a bearer token from the account routes to its account', async () => {
    const { token } = await register();
    const userId = (await env.DB.prepare('SELECT id FROM users').first<{ id: string }>())?.id;

    const session = await createSessionResolver(env)(
      new Request('https://stash.test/api/private', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(session).toEqual({ accountId: userId });
  });

  it('should resolve an unknown token to no session', async () => {
    expect(await createSessionResolver(env)(request())).toBeNull();
  });
});
