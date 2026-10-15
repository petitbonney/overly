import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildTestApp, sessionCookie, TEST_HOST, type TestApp } from '../testing/app.js';
import { fixtureManifest } from '../testing/plugins.js';
import { injectOverlayHead } from './overlay-routes.js';

const host = TEST_HOST;
const BASE = '/plugins/fixture.widgets/overlay/';
const TAGS = `<base href="${BASE}"><script src="/sdk/overlay.js"></script>`;
let running: TestApp | undefined;

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

describe('injectOverlayHead', () => {
  it.each([
    [
      '<html><head><title>x</title></head></html>',
      `<html><head>${TAGS}<title>x</title></head></html>`,
    ],
    ['<HEAD lang="en"><meta charset="utf-8">', `<HEAD lang="en">${TAGS}<meta charset="utf-8">`],
    ['<!doctype html><body>hi</body>', `<!doctype html>${TAGS}<body>hi</body>`],
    ['<p>no head at all</p>', `${TAGS}<p>no head at all</p>`],
  ])('injects the base and SDK into %s', (html, expected) => {
    expect(injectOverlayHead(html, BASE)).toBe(expected);
  });

  it('does not mistake <header> for <head>', () => {
    expect(injectOverlayHead('<header>x</header><head></head>', BASE)).toBe(
      `<header>x</header><head>${TAGS}</head>`,
    );
  });

  it('escapes the base URL', () => {
    expect(injectOverlayHead('<head>', '/plugins/a/"x"/')).toContain(
      '<base href="/plugins/a/&quot;x&quot;/">',
    );
  });
});

async function setup(
  overrides: Parameters<typeof buildTestApp>[0] = {},
  options: Parameters<typeof buildTestApp>[1] = {},
) {
  running = await buildTestApp(overrides, options);
  const widget = await running.services.service.create({ type: 'fixture.widgets:counter' });
  const get = (url: string, headers: Record<string, string> = {}) =>
    running?.app.inject({ url, headers: { host, ...headers } }) ??
    Promise.reject(new Error('no app'));
  return { ...running, widget, get };
}

describe('overlay routes', () => {
  it('serves the overlay page with the sandbox CSP and no-store', async () => {
    const { get, widget } = await setup();
    const res = await get(`/o/${widget.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-security-policy']).toBe(
      'sandbox allow-scripts; frame-ancestors http://127.0.0.1:6859 http://localhost:6859',
    );
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.body).toContain(`<head>${TAGS}<title>Counter</title>`);
  });

  it('answers 404 for an unknown widget, a type without overlay, and a broken plugin', async () => {
    const noOverlay = fixtureManifest();
    const [counter] = noOverlay.widgets ?? [];
    const { get, services } = await setup(
      {},
      {
        manifest: {
          ...noOverlay,
          widgets: [
            { ...counter, type: 'counter', name: 'Counter' },
            { type: 'plain', name: 'Plain' },
          ],
        },
        widgetFiles: {
          'zzzzzzzzzz99.json': JSON.stringify({
            schemaVersion: 1,
            id: 'zzzzzzzzzz99',
            type: 'missing.plugin:thing',
            name: 'Ghost',
            enabled: true,
            pluginVersion: '1.0.0',
            settings: {},
            state: null,
            createdAt: '2026-10-15T08:00:00.000Z',
            updatedAt: '2026-10-15T08:00:00.000Z',
          }),
        },
      },
    );
    const plain = await services.service.create({ type: 'fixture.widgets:plain' });
    for (const id of ['nonexistent12', plain.id, 'zzzzzzzzzz99']) {
      const res = await get(`/o/${id}`);
      expect(res.statusCode, id).toBe(404);
      expect(res.headers['content-type'], id).toContain('text/html');
    }
  });

  it('serves public plugin files with CORS and refuses the manifest', async () => {
    const { get } = await setup();
    const page = await get('/plugins/fixture.widgets/overlay/index.html');
    expect(page.statusCode).toBe(200);
    expect(page.headers['access-control-allow-origin']).toBe('*');
    expect(page.headers['cache-control']).toBe('no-cache');
    const icon = await get('/plugins/fixture.widgets/icons/icon.svg');
    expect(icon.statusCode).toBe(200);
    expect(icon.headers['content-type']).toContain('image/svg+xml');
    expect((await get('/plugins/fixture.widgets/overly.plugin.json')).statusCode).toBe(404);
    expect((await get('/plugins/nope/overlay/index.html')).statusCode).toBe(404);
  });

  it('does not serve encoded traversal', async () => {
    const { get } = await setup();
    for (const url of [
      '/plugins/fixture.widgets/overlay/%2e%2e/overly.plugin.json',
      '/plugins/fixture.widgets/overlay/..%2foverly.plugin.json',
      '/plugins/fixture.widgets/overlay/%5c..%5coverly.plugin.json',
      '/plugins/fixture.widgets/overlay/../overly.plugin.json',
    ]) {
      expect((await get(url)).statusCode, url).toBe(404);
    }
  });

  it('serves the SDK, or 404 with a hint when it is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'overly-sdk-'));
    const sdk = join(dir, 'overlay.js');
    await writeFile(sdk, 'window.overly = {};');
    const { get } = await setup({ overlaySdkPath: sdk });
    const res = await get('/sdk/overlay.js');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(res.body).toBe('window.overly = {};');
    await running?.app.close();

    const missing = await setup({ overlaySdkPath: join(dir, 'missing.js') });
    const notBuilt = await missing.get('/sdk/overlay.js');
    expect(notBuilt.statusCode).toBe(404);
    expect(notBuilt.body).toContain('bun run build');
  });
});

describe('dashboard pages', () => {
  it('adds the CSP to dashboard pages and keeps reserved paths out of the fallback', async () => {
    const dashboardDir = await mkdtemp(join(tmpdir(), 'overly-dashboard-'));
    await mkdir(join(dashboardDir, 'static'));
    await writeFile(join(dashboardDir, 'index.html'), '<!doctype html><title>Overly</title>');
    const { get } = await setup({ dashboardDir });
    const page = await get('/widgets/abc', { accept: 'text/html' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-security-policy']).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' ws://127.0.0.1:6859; frame-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
    );
    for (const url of ['/plugins/x', '/sdk/x']) {
      const res = await get(url, { accept: 'text/html' });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers['content-type'], url).toMatch(/^application\/json/);
    }
  });
});

describe('overlay socket', () => {
  async function listen() {
    let port = 0;
    const test = await setup({ getPort: () => port });
    await test.app.listen({ host: '127.0.0.1', port: 0 });
    port = (test.app.server.address() as AddressInfo).port;
    return { ...test, port, base: `127.0.0.1:${String(port)}` };
  }

  function collect(socket: WebSocket): Record<string, unknown>[] {
    const messages: Record<string, unknown>[] = [];
    socket.on('message', (data: Buffer) => {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    });
    return messages;
  }

  it('sends init to an overlay socket from Origin null', async () => {
    const { base, widget } = await listen();
    const socket = new WebSocket(`ws://${base}/o/${widget.id}/ws`, { origin: 'null' });
    const messages = collect(socket);
    await expect
      .poll(() => messages[0])
      .toMatchObject({
        type: 'init',
        widget: { id: widget.id, name: 'Counter' },
        active: true,
        settings: { label: 'Count', step: 1 },
      });
    socket.close();
  });

  it('still rejects Origin null on /ws', async () => {
    const { base, app, tokens } = await listen();
    const cookie = await sessionCookie(app, tokens, base);
    const socket = new WebSocket(`ws://${base}/ws`, { origin: 'null', headers: { cookie } });
    const status = await new Promise<number>((resolve) => {
      socket.on('unexpected-response', (_request, response) => {
        resolve(response.statusCode ?? 0);
      });
    });
    expect(status).toBe(403);
  });

  it('closes the socket with 4404 for an unknown widget', async () => {
    const { base } = await listen();
    const socket = new WebSocket(`ws://${base}/o/zzzzzzzzzz99/ws`, { origin: 'null' });
    const code = await new Promise<number>((resolve) => {
      socket.once('close', (closeCode) => {
        resolve(closeCode);
      });
    });
    expect(code).toBe(4404);
  });

  it('runs an action end to end through an overlay socket', async () => {
    const { base, app, tokens, widget, services } = await listen();
    const overlay = new WebSocket(`ws://${base}/o/${widget.id}/ws?preview=1`, { origin: 'null' });
    const received = collect(overlay);
    await expect.poll(() => received.length).toBe(1);
    expect(services.service.runtime(widget.id).overlays).toEqual({ live: 0, preview: 1 });

    const cookie = await sessionCookie(app, tokens, base);
    const origin = `http://${base}`;
    const res = await app.inject({
      method: 'POST',
      url: `/api/widgets/${widget.id}/actions/bump`,
      headers: { host: base, cookie, origin },
      payload: { params: { by: 3 } },
    });
    const { actionId } = res.json<{ actionId: string }>();
    await expect
      .poll(() => received[1])
      .toMatchObject({
        type: 'action',
        name: 'bump',
        params: { by: 3 },
      });
    overlay.send(JSON.stringify({ type: 'actionDone', id: received[1]?.['id'] }));
    await expect
      .poll(() =>
        services.messages.find(
          (message) =>
            message.type === 'widget.action' &&
            message.actionId === actionId &&
            message.status === 'done',
        ),
      )
      .toMatchObject({ warnings: [] });
    overlay.close();
  });
});
