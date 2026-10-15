import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { definePluginBackend, defineWidgetBackend } from '@overly/sdk/backend';
import { describe, expect, it } from 'vitest';

import { fixtureManifest } from '../testing/plugins.js';
import { counterDoc, createTestServices, TEST_WIDGET_ID as W } from '../testing/services.js';
import type { OverlaySocket } from './overlay-hub.js';
import { WidgetServiceError } from './service.js';

class FakeSocket implements OverlaySocket {
  readonly sent: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | undefined;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
}

const withBackend = fixtureManifest({ backend: 'src/backend.js' });
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function recordingBackend(calls: unknown[][], extra: Record<string, unknown> = {}) {
  return {
    'fixture.widgets': definePluginBackend({
      widgets: {
        counter: defineWidgetBackend({
          onStart: (ctx) => {
            calls.push(['start', ctx.widget.id, ctx.settings]);
          },
          onSettings: (ctx) => {
            calls.push(['settings', ctx.settings]);
          },
          onStop: () => {
            calls.push(['stop']);
          },
          ...extra,
        }),
      },
    }),
  };
}

async function expectServiceError(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<WidgetServiceError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(WidgetServiceError);
  expect(error).toMatchObject({ status, code });
  return error as WidgetServiceError;
}

function widgetFile(doc: unknown): Record<string, string> {
  return { [`${W}.json`]: JSON.stringify(doc) };
}

describe('WidgetService', () => {
  it('creates a widget with defaults and a unique name', async () => {
    const { service } = await createTestServices();
    const first = await service.create({ type: 'fixture.widgets:counter' });
    const second = await service.create({ type: 'fixture.widgets:counter' });
    expect(first).toMatchObject({
      name: 'Counter',
      typeName: 'Counter',
      iconUrl: '/plugins/fixture.widgets/icons/icon.svg',
      enabled: true,
      status: 'ok',
      problems: [],
      settings: { label: 'Count', step: 1 },
      overlayUrl: `http://127.0.0.1:6859/o/${first.id}`,
      overlay: { width: 800, height: 600 },
      runtime: { overlays: { live: 0, preview: 0 }, queue: { pending: 0, running: null } },
    });
    expect(second.name).toBe('Counter 2');
    expect(service.list().map((widget) => widget.name)).toEqual(['Counter', 'Counter 2']);
  });

  it('rejects an unknown widget type', async () => {
    const { service } = await createTestServices();
    await expectServiceError(
      service.create({ type: 'fixture.widgets:nope' }),
      404,
      'widget_type_not_found',
    );
  });

  it('rejects invalid settings with issues and keeps the file', async () => {
    const { service, dataDir } = await createTestServices({
      widgetFiles: widgetFile(counterDoc()),
    });
    const path = join(dataDir, 'widgets', `${W}.json`);
    const before = await readFile(path, 'utf8');
    const error = await expectServiceError(
      service.update(W, { settings: { label: 'x', step: 99 } }),
      400,
      'invalid_settings',
    );
    expect(error.issues).toEqual([
      { path: 'step', message: expect.stringContaining('10') as unknown },
    ]);
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('sends new settings to overlays and the backend', async () => {
    const calls: unknown[][] = [];
    const { service, overlays } = await createTestServices({
      manifest: withBackend,
      builtins: recordingBackend(calls),
      widgetFiles: widgetFile(counterDoc()),
    });
    const socket = new FakeSocket();
    service.overlayAttached(overlays.attach(W, socket, false));
    await service.update(W, { settings: { label: 'New', step: 2 } });
    await tick();
    expect(socket.sent).toEqual([
      {
        type: 'init',
        widget: { id: W, name: 'Counter', type: 'fixture.widgets:counter' },
        active: true,
        settings: { label: 'Count', step: 1 },
      },
      { type: 'settings', settings: { label: 'New', step: 2 } },
    ]);
    expect(calls).toEqual([
      ['start', W, { label: 'Count', step: 1 }],
      ['settings', { label: 'New', step: 2 }],
    ]);
  });

  it('stops the backend and deactivates overlays when disabled, and restarts them', async () => {
    const calls: unknown[][] = [];
    const { service, overlays } = await createTestServices({
      manifest: withBackend,
      builtins: recordingBackend(calls),
      widgetFiles: widgetFile(counterDoc()),
    });
    const socket = new FakeSocket();
    service.overlayAttached(overlays.attach(W, socket, false));
    await service.update(W, { enabled: false });
    expect(service.isActive(W)).toBe(false);
    await service.update(W, { enabled: true, name: 'Renamed' });
    await tick();
    expect(socket.sent.slice(1)).toEqual([
      { type: 'widget', name: 'Counter', active: false },
      { type: 'widget', name: 'Renamed', active: true },
    ]);
    expect(calls.map((call) => call[0])).toEqual(['start', 'stop', 'start']);
  });

  it('duplicates without state', async () => {
    const { service, store } = await createTestServices({
      widgetFiles: widgetFile(counterDoc({ state: { n: 5 }, settings: { label: 'X', step: 3 } })),
    });
    const copy = await service.duplicate(W);
    expect(copy).toMatchObject({ name: 'Counter (copy)', settings: { label: 'X', step: 3 } });
    expect(copy.id).not.toBe(W);
    expect(store.get(copy.id)).toMatchObject({ doc: { state: null, pluginVersion: '1.0.0' } });
  });

  it('deletes the file and closes overlays with 4404', async () => {
    const { service, overlays, store } = await createTestServices({
      widgetFiles: widgetFile(counterDoc()),
    });
    const socket = new FakeSocket();
    service.overlayAttached(overlays.attach(W, socket, false));
    await service.delete(W);
    expect(socket.closed).toEqual({ code: 4404, reason: 'widget deleted' });
    expect(store.get(W)).toBeUndefined();
    expect(service.has(W)).toBe(false);
    await expectServiceError(service.delete(W), 404, 'widget_not_found');
  });

  it.each([
    ['plugin_missing', widgetFile(counterDoc({ type: 'missing.plugin:thing' }))],
    ['plugin_broken', widgetFile(counterDoc({ type: 'broken.plugin:thing' }))],
    ['type_missing', widgetFile(counterDoc({ type: 'fixture.widgets:nope' }))],
    ['settings_invalid', widgetFile(counterDoc({ settings: { label: 'x', step: 99 } }))],
    ['unreadable', { [`${W}.json`]: '{ bad' }],
    ['unsupported_version', widgetFile({ ...counterDoc(), schemaVersion: 2 })],
  ])('reports %s', async (code, widgetFiles) => {
    const { service } = await createTestServices({
      widgetFiles,
      extraPlugins: {
        broken: { ...fixtureManifest({ id: 'broken.plugin' }), apiVersion: 9 },
      },
    });
    const [widget] = service.list();
    expect(widget).toMatchObject({ id: W, status: 'broken', problems: [{ code }] });
    expect(widget?.problems[0]?.message).not.toBe('');
    expect(service.isActive(W)).toBe(false);
  });

  it('migrates settings from an older plugin version and saves the new version', async () => {
    const { service, dataDir } = await createTestServices({
      manifest: fixtureManifest({ backend: 'src/backend.js', version: '1.1.0' }),
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend({
              migrateSettings: ({ title, ...rest }) => ({ ...rest, label: title }),
            }),
          },
        }),
      },
      widgetFiles: widgetFile(counterDoc({ settings: { title: 'Old', step: 2 } })),
    });
    expect(service.detail(W)).toMatchObject({ status: 'ok', settings: { label: 'Old', step: 2 } });
    const saved = JSON.parse(
      await readFile(join(dataDir, 'widgets', `${W}.json`), 'utf8'),
    ) as unknown;
    expect(saved).toMatchObject({ pluginVersion: '1.1.0', settings: { label: 'Old', step: 2 } });
  });

  it('saving fixed settings after a failed migration records the installed version', async () => {
    const { service, dataDir } = await createTestServices({
      manifest: fixtureManifest({ backend: 'src/backend.js', version: '1.1.0' }),
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend({
              migrateSettings: ({ title, ...rest }) => ({ ...rest, label: title }),
            }),
          },
        }),
      },
      widgetFiles: widgetFile(counterDoc({ settings: { title: 'Old', step: 99 } })),
    });
    expect(service.detail(W).problems[0]?.code).toBe('settings_invalid');
    const saved = await service.update(W, { settings: { label: 'Fixed by user', step: 2 } });
    expect(saved).toMatchObject({ status: 'ok', problems: [] });
    const file = JSON.parse(
      await readFile(join(dataDir, 'widgets', `${W}.json`), 'utf8'),
    ) as unknown;
    // Otherwise the next start would migrate the user's fixed settings again.
    expect(file).toMatchObject({
      pluginVersion: '1.1.0',
      settings: { label: 'Fixed by user', step: 2 },
    });
  });

  it('leaves widgets from a newer plugin version broken and untouched', async () => {
    const { service, dataDir } = await createTestServices({
      widgetFiles: widgetFile(counterDoc({ pluginVersion: '2.0.0' })),
    });
    expect(service.list()[0]?.problems[0]?.code).toBe('newer_plugin_version');
    const path = join(dataDir, 'widgets', `${W}.json`);
    const before = await readFile(path, 'utf8');
    await expectServiceError(service.update(W, { name: 'X' }), 409, 'widget_broken');
    expect(await readFile(path, 'utf8')).toBe(before);
  });

  it('publishes valid widget events and drops invalid ones', async () => {
    const { service, events } = await createTestServices({ widgetFiles: widgetFile(counterDoc()) });
    const seen: unknown[] = [];
    events.subscribe((event) => seen.push(event));
    service.emitEvent(W, 'counter.changed', { value: 2 });
    service.emitEvent(W, 'counter.changed', { value: 'two' });
    service.emitEvent(W, 'counter.exploded', {});
    expect(seen).toEqual([
      {
        source: 'widget',
        widgetId: W,
        widgetType: 'fixture.widgets:counter',
        name: 'counter.changed',
        payload: { value: 2 },
        at: '2026-10-15T09:00:00.000Z',
      },
    ]);
  });

  it('saves backend state', async () => {
    const { store } = await createTestServices({
      manifest: withBackend,
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend<Record<string, unknown>, { started: boolean }>({
              onStart: (ctx) => {
                ctx.setState({ started: true });
              },
            }),
          },
        }),
      },
      widgetFiles: widgetFile(counterDoc()),
    });
    await tick();
    await store.flush();
    expect(store.get(W)).toMatchObject({ doc: { state: { started: true } } });
  });

  it('logs a failing onStart and keeps the widget ok', async () => {
    const { service } = await createTestServices({
      manifest: withBackend,
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend({
              onStart: () => {
                throw new Error('cannot start');
              },
            }),
          },
        }),
      },
      widgetFiles: widgetFile(counterDoc()),
    });
    await tick();
    expect(service.detail(W).status).toBe('ok');
  });

  it('broadcasts widgets.changed', async () => {
    const { service, messages } = await createTestServices();
    const widget = await service.create({ type: 'fixture.widgets:counter' });
    await service.update(widget.id, { name: 'Renamed' });
    await service.delete(widget.id);
    expect(messages.filter((message) => message.type === 'widgets.changed')).toEqual([
      { type: 'widgets.changed', widgetId: widget.id },
      { type: 'widgets.changed', widgetId: widget.id },
      { type: 'widgets.changed', widgetId: widget.id },
    ]);
  });

  it('broadcasts the runtime when overlays connect', async () => {
    const { service, overlays, messages } = await createTestServices({
      widgetFiles: widgetFile(counterDoc()),
    });
    service.overlayAttached(overlays.attach(W, new FakeSocket(), true));
    expect(messages).toContainEqual({
      type: 'widget.runtime',
      widgetId: W,
      runtime: { overlays: { live: 0, preview: 1 }, queue: { pending: 0, running: null } },
    });
  });
});
