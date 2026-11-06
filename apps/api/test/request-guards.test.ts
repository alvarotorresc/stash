import { API_PATHS } from '@stash/core/protocol';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { EXTRACT_PATH } from '../src/extract/routes';
import { accountSetup, call, errorOf, register, uniqueEmail } from './helpers';

/**
 * A `text/plain` POST is a "simple" request: a browser sends it across origins without a
 * preflight. Requiring JSON forces the preflight, which the API never grants, and browsers mark
 * requests from other sites with `Sec-Fetch-Site: cross-site`.
 */
describe('JSON bodies only', () => {
  it.each([
    ['text/plain', 'text/plain'],
    ['a form', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=x'],
    ['a lookalike', 'application/jsonx'],
  ])('should refuse %s with 415 before counting the request', async (_, contentType) => {
    const ip = '203.0.113.40';
    const res = await call(API_PATHS.register, {
      ip,
      headers: { 'Content-Type': contentType },
      body: { email: uniqueEmail(), keys: accountSetup() },
    });

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect((await env.DB.prepare('SELECT count(*) AS n FROM rate_limits').first())?.n).toBe(0);
  });

  it('should refuse a body with no content type', async () => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Content-Type': '' },
      body: { email: uniqueEmail() },
    });

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('should refuse text/plain on the salt step, which counts nothing', async () => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ email: uniqueEmail() }),
    });

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('should refuse text/plain on authenticated routes with a body', async () => {
    const { token, keys } = await register();

    const res = await call(API_PATHS.account, {
      method: 'DELETE',
      token,
      headers: { 'Content-Type': 'text/plain' },
      body: { loginKey: keys.loginKey },
    });

    expect(await errorOf(res)).toEqual({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE' });
  });

  it('should accept JSON with a charset', async () => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { email: uniqueEmail() },
    });

    expect(res.status).toBe(200);
  });
});

describe('cross-site requests', () => {
  it.each([
    ['register', API_PATHS.register, { email: 'a@example.com', keys: {} }],
    ['the salt step', API_PATHS.prelogin, { email: 'a@example.com' }],
    ['extraction', EXTRACT_PATH, { url: 'https://example.com/' }],
  ])('should refuse %s from another site with 403', async (_, path, body) => {
    const res = await call(path, { headers: { 'Sec-Fetch-Site': 'cross-site' }, body });

    expect(await errorOf(res)).toEqual({ status: 403, code: 'CROSS_SITE_REQUEST' });
  });

  it('should refuse authenticated reads from another site', async () => {
    const { token } = await register();

    const res = await call(API_PATHS.account, {
      token,
      headers: { 'Sec-Fetch-Site': 'cross-site' },
    });

    expect(await errorOf(res)).toEqual({ status: 403, code: 'CROSS_SITE_REQUEST' });
  });

  it.each(['same-origin', 'same-site', 'none'])('should let %s through', async (site) => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Sec-Fetch-Site': site },
      body: { email: uniqueEmail() },
    });

    expect(res.status).toBe(200);
  });

  it('should let clients that are not browsers through without the header', async () => {
    const res = await call(API_PATHS.prelogin, { body: { email: uniqueEmail() } });

    expect(res.status).toBe(200);
  });
});
