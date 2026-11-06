import type { Fetcher } from '../src/extract/safe-fetch';

export interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

type Route = (call: RecordedCall) => Response | Promise<Response>;

/**
 * Fake outbound fetch: answers from a map of exact URLs and records every call. An unknown URL
 * fails the test loudly instead of reaching the network.
 */
export function fakeFetch(routes: Record<string, Route>) {
  const calls: RecordedCall[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const call = { url, init };
    calls.push(call);
    const route = routes[url];
    if (!route) throw new Error(`unexpected outbound request: ${url}`);
    return route(call);
  }) as Fetcher;
  return { fetch, calls };
}

export function html(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    ...init,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...init.headers },
  });
}

export function redirect(location: string, status = 301): Response {
  return new Response(null, { status, headers: { Location: location } });
}

/** A body stream that keeps producing chunks and records whether it was cancelled. */
export function endlessStream(chunkSize = 1024) {
  const state = { cancelled: false, pulled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      state.pulled += 1;
      controller.enqueue(new Uint8Array(chunkSize).fill(120));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

/** A fetch that never answers until its signal aborts. */
export const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  })) as Fetcher;
