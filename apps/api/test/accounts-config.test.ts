import { env } from 'cloudflare:workers';
import { API_PATHS } from '@stash/core/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAccountsRequest, isAccountsPath } from '../src/accounts/routes';
import { BASE_URL, errorOf, uniqueEmail } from './helpers';

function prelogin(): Request {
  return new Request(`${BASE_URL}${API_PATHS.prelogin}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: uniqueEmail() }),
  });
}

describe('handleAccountsRequest', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['missing', undefined],
    ['too short', 'short'],
  ])('should answer 500 and do nothing when the pepper is %s', async (_case, pepper) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await handleAccountsRequest(prelogin(), { DB: env.DB, PEPPER: pepper });

    expect(await errorOf(res)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
  });

  it('should answer 500 without details when the database fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      prepare() {
        throw new Error('SQLITE_ERROR: secret detail');
      },
    } as unknown as D1Database;

    const res = await handleAccountsRequest(prelogin(), { DB: broken, PEPPER: env.PEPPER });

    expect({
      body: await res.text(),
      logged: error.mock.calls.flat().join(' ').includes('secret detail'),
    }).toEqual({
      body: JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }),
      logged: false,
    });
  });

  it('should log a generic line when something that is not an Error is thrown', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      prepare() {
        throw 'boom';
      },
    } as unknown as D1Database;

    await handleAccountsRequest(prelogin(), { DB: broken, PEPPER: env.PEPPER });

    expect(error).toHaveBeenCalledWith('accounts: unexpected error');
  });
});

describe('isAccountsPath', () => {
  it.each([
    ['/api/auth/login', true],
    ['/api/account', true],
    ['/api/account/password', true],
    ['/api/accounts', false],
    ['/api/authx', false],
    ['/api/health', false],
  ])('should classify %s as %s', (path, expected) => {
    expect(isAccountsPath(path)).toBe(expected);
  });
});
