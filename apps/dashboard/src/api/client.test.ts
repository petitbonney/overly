import { RunActionResponseSchema, SessionResponseSchema } from '@overly/shared';
import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiDelete, apiGet, apiSend, apiUpload } from './client.js';

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

describe('apiSend', () => {
  it('sends JSON with the method and parses error issues', async () => {
    const fetchImpl = respond(400, {
      error: 'invalid_settings',
      message: 'Some settings are invalid',
      issues: [{ path: 'step', message: 'Too big' }],
    });
    const error: unknown = await apiSend(
      'PATCH',
      '/api/widgets/x',
      { name: 'A' },
      RunActionResponseSchema,
      fetchImpl,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'invalid_settings',
      detail: 'Some settings are invalid',
      issues: [{ path: 'step', message: 'Too big' }],
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/widgets/x', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: '{"name":"A"}',
    });
  });

  it('parses a success body', async () => {
    const fetchImpl = respond(202, { actionId: 'a1', status: 'queued' });
    expect(
      await apiSend('POST', '/api/widgets/x/actions/show', {}, RunActionResponseSchema, fetchImpl),
    ).toEqual({ actionId: 'a1', status: 'queued' });
  });
});

describe('apiDelete', () => {
  it('accepts 204 and throws on errors', async () => {
    const ok = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiDelete('/api/widgets/x', ok)).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledWith('/api/widgets/x', {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });
    await expect(
      apiDelete('/api/widgets/x', respond(404, { error: 'widget_not_found' })),
    ).rejects.toMatchObject({ status: 404, code: 'widget_not_found' });
  });
});

describe('apiUpload', () => {
  it('sends the raw file with its encoded name', async () => {
    const asset = {
      id: 'abcdefghij12',
      name: 'Mon son.mp3',
      kind: 'audio',
      mime: 'audio/mpeg',
      size: 3,
      sha256: 'a'.repeat(64),
      createdAt: '2026-10-15T09:00:00.000Z',
    };
    const fetchImpl = respond(201, asset);
    const file = new File(['abc'], 'Mon son.mp3', { type: 'audio/mpeg' });
    expect(await apiUpload(file, fetchImpl)).toEqual(asset);
    expect(fetchImpl).toHaveBeenCalledWith('/api/assets?name=Mon%20son.mp3', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      body: file,
    });
  });
});
