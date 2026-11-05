import { describe, expect, it, vi } from 'vitest';
import { requireSession, resolveSession, type Session } from '../src/auth/session';
import { allowAll } from '../src/rate-limit';

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
});

describe('resolveSession', () => {
  it('should fail closed until sessions exist', async () => {
    expect(await resolveSession(request())).toBeNull();
  });
});

describe('allowAll', () => {
  it('should let every request through', async () => {
    expect(await allowAll.limit({ key: 'account-1' })).toEqual({ success: true });
  });
});
