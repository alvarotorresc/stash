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

describe('requests from the browser extension', () => {
  const CHROME = `chrome-extension://${'a'.repeat(32)}`;
  const FIREFOX = 'moz-extension://3f2b8c1e-9d4a-4e6b-8a57-0c1d2e3f4a5b';

  it.each([
    ['Chrome', CHROME],
    ['Firefox', FIREFOX],
  ])('should let a cross-site request from the %s extension through', async (_, origin) => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Sec-Fetch-Site': 'cross-site', Origin: origin },
      body: { email: uniqueEmail() },
    });

    expect(res.status).toBe(200);
  });

  it('should let an authenticated cross-site request from the extension reach its route', async () => {
    const { token } = await register();

    const res = await call(API_PATHS.account, {
      token,
      headers: { 'Sec-Fetch-Site': 'cross-site', Origin: CHROME },
    });

    expect(res.status).not.toBe(403);
  });

  it('should still refuse a web page cross-site, whatever else it sends', async () => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Sec-Fetch-Site': 'cross-site', Origin: 'https://evil.example' },
      body: { email: uniqueEmail() },
    });

    expect(await errorOf(res)).toEqual({ status: 403, code: 'CROSS_SITE_REQUEST' });
  });

  it.each([
    ['a short Chrome id', 'chrome-extension://abc'],
    ['capital letters in the Chrome id', `chrome-extension://${'A'.repeat(32)}`],
    ['a Chrome id followed by a host', `${CHROME}.evil.example`],
    ['a Chrome origin with a path', `${CHROME}/page.html`],
    ['a Firefox origin that is not a UUID', 'moz-extension://notauuid'],
    ['a Firefox origin followed by a host', `${FIREFOX}.evil.example`],
    ['another extension scheme', `safari-web-extension://${'a'.repeat(32)}`],
    ['the opaque origin', 'null'],
    ['an empty origin', ''],
  ])('should refuse a cross-site request with %s', async (_, origin) => {
    const res = await call(API_PATHS.prelogin, {
      headers: { 'Sec-Fetch-Site': 'cross-site', Origin: origin },
      body: { email: uniqueEmail() },
    });

    expect(await errorOf(res)).toEqual({ status: 403, code: 'CROSS_SITE_REQUEST' });
  });

  it('should still let a request with no Origin through, as before', async () => {
    const res = await call(API_PATHS.prelogin, { body: { email: uniqueEmail() } });

    expect(res.status).toBe(200);
  });
});
