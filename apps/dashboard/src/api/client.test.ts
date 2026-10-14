import { SessionResponseSchema } from '@overly/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiGet } from './client.js';

function respond(status: number, body: unknown) {
  return vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('apiGet', () => {
  it('throws ApiError with status and code', async () => {
    const error: unknown = await apiGet(
      '/api/session',
      SessionResponseSchema,
      respond(401, { error: 'no_session' }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: 'no_session' });
  });

  it('parses the body with the schema', async () => {
    const fetchImpl = respond(200, { authenticated: true });
    expect(await apiGet('/api/session', SessionResponseSchema, fetchImpl)).toEqual({
      authenticated: true,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/session', {
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
  });

  it('rejects a body that fails the schema', async () => {
    await expect(
      apiGet('/api/session', SessionResponseSchema, respond(200, { authenticated: false })),
    ).rejects.toThrow();
  });
});
