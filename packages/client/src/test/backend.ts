import type { ExtractData } from '@stash/core/extract';
import { RECORDS_PATH } from '@stash/core/sync-protocol';
import { FakeRecordsServer, FakeServer } from '@stash/core/testing';
import { EXTRACT_IMAGE_PATH, EXTRACT_PATH } from '../extract';

type ExtractAnswer = ExtractData | { status: number; code: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** A web page as the proxy returns it. */
export function webPage(
  url: string,
  title: string,
  paragraphs: string[],
  image?: string,
): ExtractData {
  const body = paragraphs.map((text) => `<p>${text}</p>`).join('');
  return {
    kind: 'web',
    page: {
      url,
      contentType: 'text/html',
      body: `<html><head><title>${title}</title><meta property="og:description" content="${title}, resumen">${image ? `<meta property="og:image" content="${image}">` : ''}</head><body><article><h1>${title}</h1>${body}</article></body></html>`,
      truncated: false,
    },
  };
}

/**
 * The whole API in memory: accounts, records (one set per account, whatever the session) and the
 * extraction proxy, which answers what each test sets per URL.
 */
export class FakeBackend {
  readonly accounts = new FakeServer();
  readonly records = new FakeRecordsServer();
  readonly pages = new Map<string, ExtractAnswer>();
  readonly extracted: string[] = [];
  /** What the image proxy answers per image URL; unknown ones fail like a gone image. */
  readonly images = new Map<
    string,
    { type: string; bytes: Uint8Array } | { status: number; code: string }
  >();
  readonly imagesFetched: string[] = [];
  online = true;

  readonly fetch: typeof fetch = async (input, init) => {
    if (!this.online) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    if (url.pathname === RECORDS_PATH) return this.forwardRecords(input, init);
    if (url.pathname === EXTRACT_PATH) return this.extract(init);
    if (url.pathname === EXTRACT_IMAGE_PATH) return this.image(init);
    return this.accounts.fetch(input, init);
  };

  /** The account behind a bearer token, or null when the session is unknown or closed. */
  private emailOf(init: RequestInit | undefined): string | null {
    const token = new Headers(init?.headers).get('Authorization')?.slice(7) ?? '';
    return this.accounts.sessions.get(token) ?? null;
  }

  private forwardRecords(input: Parameters<typeof fetch>[0], init?: RequestInit) {
    const email = this.emailOf(init);
    if (email === null) return json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${email}`);
    return this.records.fetch(input, { ...init, headers });
  }

  private image(init?: RequestInit): Response {
    if (this.emailOf(init) === null) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401);
    }
    const { url } = JSON.parse(String(init?.body)) as { url: string };
    this.imagesFetched.push(url);
    const answer = this.images.get(url) ?? { status: 502, code: 'UPSTREAM_ERROR' };
    if ('status' in answer) {
      return json({ error: { code: answer.code, message: answer.code } }, answer.status);
    }
    return new Response(answer.bytes.slice(), { headers: { 'Content-Type': answer.type } });
  }

  private extract(init?: RequestInit): Response {
    if (this.emailOf(init) === null) {
      return json({ error: { code: 'UNAUTHORIZED', message: 'x' } }, 401);
    }
    const { url } = JSON.parse(String(init?.body)) as { url: string };
    this.extracted.push(url);
    const answer = this.pages.get(url) ?? { status: 502, code: 'UPSTREAM_ERROR' };
    if ('status' in answer) {
      return json({ error: { code: answer.code, message: answer.code } }, answer.status);
    }
    return json({ data: answer });
  }
}
