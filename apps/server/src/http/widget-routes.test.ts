import type { AddressInfo } from 'node:net';

import { WidgetDetailSchema } from '@overly/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  buildTestApp,
  sessionCookie,
  TEST_HOST,
  TEST_ORIGIN,
  type TestApp,
} from '../testing/app.js';
import { fixtureManifest } from '../testing/plugins.js';

const host = TEST_HOST;
let running: TestApp | undefined;

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

async function setup(options: Parameters<typeof buildTestApp>[1] = {}) {
  const test = await buildTestApp({}, options);
  running = test;
  const cookie = await sessionCookie(test.app, test.tokens);
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    test.app.inject({
      method,
      url,
      headers: { host, cookie, ...(method === 'GET' ? {} : { origin: TEST_ORIGIN }) },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  return { ...test, cookie, send };
}

describe('plugin routes', () => {
  it('lists ok and broken plugins with errors and widget types', async () => {
    const { send } = await setup({
      extraPlugins: { broken: { ...fixtureManifest({ id: 'broken.plugin' }), apiVersion: 9 } },
    });
    const res = await send('GET', '/api/plugins');
    expect(res.statusCode).toBe(200);
    const { plugins } = res.json<{ plugins: Record<string, unknown>[] }>();
    expect(plugins).toEqual([
      {
        id: 'broken.plugin',
        folder: 'broken',
        name: 'Fixture widgets',
        version: '1.0.0',
        iconUrl: null,
        status: 'broken',
        errors: ['This plugin needs a newer version of Overly (plugin API 9).'],
        widgetTypes: [],
      },
      expect.objectContaining({
        id: 'fixture.widgets',
        folder: 'fixture',
        status: 'ok',
        iconUrl: '/plugins/fixture.widgets/icons/icon.svg',
        errors: [],
      }),
    ]);
    expect(plugins[1]?.['widgetTypes']).toEqual([
      expect.objectContaining({
        type: 'fixture.widgets:counter',
        pluginId: 'fixture.widgets',
        name: 'Counter',
        iconUrl: '/plugins/fixture.widgets/icons/icon.svg',
        overlay: { width: 800, height: 600 },
        actions: [
          expect.objectContaining({ name: 'bump', title: 'Bump', queued: true, sample: { by: 1 } }),
          expect.objectContaining({ name: 'ping', queued: false, sample: {} }),
        ],
        events: [expect.objectContaining({ name: 'counter.changed', sample: { value: 1 } })],
      }),
    ]);
  });
});

describe('widget routes', () => {
  it('creates, reads, updates, duplicates and deletes a widget', async () => {
    const { send } = await setup();
    const created = await send('POST', '/api/widgets', { type: 'fixture.widgets:counter' });
    expect(created.statusCode).toBe(201);
    const widget = WidgetDetailSchema.parse(created.json());
    expect(widget).toMatchObject({ name: 'Counter', settings: { label: 'Count', step: 1 } });

    const listed = await send('GET', '/api/widgets');
    expect(listed.json()).toMatchObject({ widgets: [{ id: widget.id, name: 'Counter' }] });

    const read = await send('GET', `/api/widgets/${widget.id}`);
    expect(read.statusCode).toBe(200);

    const updated = await send('PATCH', `/api/widgets/${widget.id}`, {
      name: 'Renamed',
      settings: { label: 'Hits', step: 2 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: 'Renamed', settings: { label: 'Hits', step: 2 } });

    const copy = await send('POST', `/api/widgets/${widget.id}/duplicate`);
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Renamed (copy)' });

    expect((await send('DELETE', `/api/widgets/${widget.id}`)).statusCode).toBe(204);
    expect((await send('GET', `/api/widgets/${widget.id}`)).json()).toEqual({
      error: 'widget_not_found',
    });
  });

  it('answers 400 invalid_body with issues', async () => {
    const { send } = await setup();
    const res = await send('POST', '/api/widgets', { type: 'counter' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_body', issues: [{ path: 'type' }] });
    const empty = await send('PATCH', '/api/widgets/abcdefghij12', {});
    expect(empty.statusCode).toBe(400);
  });

  it('answers invalid settings with their issues', async () => {
    const { send } = await setup();
    const { id } = (await send('POST', '/api/widgets', { type: 'fixture.widgets:counter' })).json<{
      id: string;
    }>();
    const res = await send('PATCH', `/api/widgets/${id}`, { settings: { label: 'x', step: 50 } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_settings', issues: [{ path: 'step' }] });
  });

  it('runs an action with 202 and an actionId', async () => {
    const { send } = await setup();
    const { id } = (await send('POST', '/api/widgets', { type: 'fixture.widgets:counter' })).json<{
      id: string;
    }>();
    const res = await send('POST', `/api/widgets/${id}/actions/bump`, { params: { by: 2 } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({
      actionId: expect.stringMatching(/^[a-z0-9]{12}$/) as unknown,
      status: 'running',
    });
    const bad = await send('POST', `/api/widgets/${id}/actions/bump`, { params: {} });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ error: 'invalid_params' });
    const missing = await send('POST', `/api/widgets/${id}/actions/nope`);
    expect(missing.statusCode).toBe(404);
  });

  it('requires the session and an allowed Origin', async () => {
    const { app, cookie } = await setup();
    const noSession = await app.inject({ url: '/api/widgets', headers: { host } });
    expect(noSession.statusCode).toBe(401);
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({
        method,
        url: '/api/widgets/abcdefghij12',
        headers: { host, cookie },
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('builds overlayUrl from the server port', async () => {
    const { app, cookie } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/widgets',
      headers: { host: 'localhost:6859', cookie, origin: 'http://localhost:6859' },
      payload: { type: 'fixture.widgets:counter' },
    });
    const { id, overlayUrl } = res.json<{ id: string; overlayUrl: string }>();
    expect(overlayUrl).toBe(`http://127.0.0.1:6859/o/${id}`);
  });
});

describe('dashboard broadcasts', () => {
  it('broadcasts widget messages to dashboard sockets', async () => {
    let port = 0;
    running = await buildTestApp({ getPort: () => port });
    await running.app.listen({ host: '127.0.0.1', port: 0 });
    port = (running.app.server.address() as AddressInfo).port;
    const origin = `http://127.0.0.1:${String(port)}`;
    const cookie = await sessionCookie(running.app, running.tokens, `127.0.0.1:${String(port)}`);
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie },
      origin,
    });
    const received: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data: Buffer) => {
        received.push(JSON.parse(data.toString()) as Record<string, unknown>);
        resolve();
      });
      socket.once('error', reject);
    });
    const created = await running.app.inject({
      method: 'POST',
      url: '/api/widgets',
      headers: { host: `127.0.0.1:${String(port)}`, cookie, origin },
      payload: { type: 'fixture.widgets:counter' },
    });
    const { id, overlayUrl } = created.json<{ id: string; overlayUrl: string }>();
    expect(overlayUrl).toBe(`${origin}/o/${id}`);
    await expect
      .poll(() => received.map((message) => message['type']))
      .toEqual(['hello', 'widgets.changed']);
    expect(received[1]).toEqual({ type: 'widgets.changed', widgetId: id });
    socket.close();
  });
});
