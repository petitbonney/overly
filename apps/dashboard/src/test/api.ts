import { vi } from 'vitest';

export interface ApiCall {
  method: string;
  /** Path and query, e.g. `/api/assets?kind=image`. */
  url: string;
  body: unknown;
}

export interface ApiAnswer {
  status?: number;
  body?: unknown;
}

/**
 * Replaces `fetch` with `handler`, which answers by method and URL (`undefined` = 404). Every
 * call is recorded; JSON bodies are parsed, other bodies (files) are kept as they are.
 */
export function mockApi(handler: (call: ApiCall) => ApiAnswer | undefined): ApiCall[] {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const raw = init?.body;
      const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const call = { method: init?.method ?? 'GET', url, body };
      calls.push(call);
      const answer = handler(call) ?? { status: 404, body: { error: 'not_found' } };
      const status = answer.status ?? 200;
      return Promise.resolve(
        new Response(status === 204 ? null : JSON.stringify(answer.body ?? {}), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
  return calls;
}
