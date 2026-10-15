import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  definePluginBackend,
  defineWidgetBackend,
  type PluginBackendDefinition,
} from '@overly/sdk/backend';
import type { ChannelEnd, JsonValue } from '@overly/shared';
import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { PluginRegistry } from '../plugins/registry.js';
import { fixtureManifest, type ManifestInput, writeTestPlugin } from '../testing/plugins.js';
import { type BackendDelegate, BackendHost } from './backend-host.js';
import type { OverlayOutcome } from './overlay-hub.js';

const W = 'abcdefghij12';
const logger = pino({ level: 'silent' });
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overly-backends-'));
});

class RecordingDelegate implements BackendDelegate {
  readonly calls: unknown[][] = [];
  outcome: OverlayOutcome = { delivered: false };
  setState(widgetId: string, state: JsonValue): void {
    this.calls.push(['setState', widgetId, state]);
  }
  emitToOverlay(widgetId: string, name: string, payload: unknown, overlayId?: string): void {
    this.calls.push(['emitToOverlay', widgetId, name, payload, overlayId]);
  }
  overlayAction(
    widgetId: string,
    request: {
      name: string;
      params: unknown;
      timeoutMs: number | undefined;
      actionId: string | undefined;
    },
  ): Promise<OverlayOutcome> {
    this.calls.push(['overlayAction', widgetId, request]);
    return Promise.resolve(this.outcome);
  }
  emitEvent(widgetId: string, name: string, payload: unknown): void {
    this.calls.push(['emitEvent', widgetId, name, payload]);
  }
}

async function host(
  options: {
    manifest?: ManifestInput;
    builtins?: Record<string, PluginBackendDefinition>;
    run?: (channel: ChannelEnd) => { close(): void };
    readyTimeoutMs?: number;
  } = {},
) {
  await writeTestPlugin(
    root,
    'fixture',
    options.manifest ?? fixtureManifest({ backend: 'src/backend.js' }),
    { 'src/backend.js': 'export default {};' },
  );
  const registry = await PluginRegistry.load({ pluginsDir: root, logger });
  const delegate = new RecordingDelegate();
  const backends = await BackendHost.start({
    registry,
    builtins: options.builtins ?? {},
    delegate,
    logger,
    ...(options.run === undefined ? {} : { run: options.run }),
    ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
  });
  return { registry, delegate, backends };
}

function counterBackend(actions: Record<string, (...args: never[]) => unknown> = {}) {
  return {
    'fixture.widgets': definePluginBackend({
      widgets: {
        counter: defineWidgetBackend({
          migrateSettings: (settings) => ({ ...settings, label: 'Migrated' }),
          actions: { bump: (params) => ({ got: params['by'] }), ...actions },
        }),
      },
    }),
  };
}

function startCounter(backends: BackendHost): void {
  backends.connection('fixture.widgets')?.startWidget({
    widgetId: W,
    widgetType: 'counter',
    widget: { id: W, name: 'Counter' },
    settings: { label: 'Count', step: 1 },
    state: null,
  });
}

describe('BackendHost', () => {
  it('starts a builtin backend and learns what it handles', async () => {
    const { backends, registry } = await host({ builtins: counterBackend() });
    const connection = backends.connection('fixture.widgets');
    expect(connection?.handles('counter', 'bump')).toBe(true);
    expect(connection?.handles('counter', 'ping')).toBe(false);
    expect(connection?.migrates('counter')).toBe(true);
    expect(registry.plugin('fixture.widgets')?.status).toBe('ok');
  });

  it('runs an action and returns its result', async () => {
    const { backends } = await host({ builtins: counterBackend() });
    startCounter(backends);
    const result = await backends
      .connection('fixture.widgets')
      ?.runAction(W, { actionId: 'a1', name: 'bump', params: { by: 3 }, timeoutMs: 1000 });
    expect(result).toEqual({ got: 3 });
  });

  it('rejects with the backend error', async () => {
    const { backends } = await host({
      builtins: counterBackend({
        bump: () => {
          throw new Error('nope');
        },
      }),
    });
    startCounter(backends);
    await expect(
      backends
        .connection('fixture.widgets')
        ?.runAction(W, { actionId: 'a1', name: 'bump', params: { by: 1 }, timeoutMs: 1000 }),
    ).rejects.toThrow('nope');
  });

  it('rejects with timeout when a handler never settles', async () => {
    const { backends } = await host({
      builtins: counterBackend({ bump: () => new Promise(() => undefined) }),
    });
    startCounter(backends);
    await expect(
      backends
        .connection('fixture.widgets')
        ?.runAction(W, { actionId: 'a1', name: 'bump', params: { by: 1 }, timeoutMs: 50 }),
    ).rejects.toThrow('timeout');
  });

  it('forwards setState, emitToOverlay, overlayAction and emitEvent to the delegate', async () => {
    const { backends, delegate } = await host({
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend<Record<string, unknown>, { n: number }>({
              actions: {
                bump: async (_params, ctx) => {
                  ctx.setState({ n: 1 });
                  ctx.emitToOverlay('count', { n: 1 });
                  const outcome = await ctx.runOverlayAction('flash', { color: 'red' });
                  ctx.emitEvent('counter.changed', { value: 1 });
                  return outcome;
                },
              },
            }),
          },
        }),
      },
    });
    startCounter(backends);
    const result = await backends
      .connection('fixture.widgets')
      ?.runAction(W, { actionId: 'a1', name: 'bump', params: { by: 1 }, timeoutMs: 1000 });
    expect(result).toEqual({ delivered: false });
    expect(delegate.calls.map((call) => call[0])).toEqual([
      'setState',
      'emitToOverlay',
      'overlayAction',
      'emitEvent',
    ]);
    expect(delegate.calls[0]).toEqual(['setState', W, { n: 1 }]);
    expect(delegate.calls[1]).toEqual(['emitToOverlay', W, 'count', { n: 1 }, undefined]);
    expect(delegate.calls[3]).toEqual(['emitEvent', W, 'counter.changed', { value: 1 }]);
    const request = delegate.calls[2]?.[2] as { timeoutMs: number };
    expect(request).toMatchObject({ name: 'flash', params: { color: 'red' }, actionId: 'a1' });
    expect(request.timeoutMs).toBeGreaterThan(0);
    expect(request.timeoutMs).toBeLessThanOrEqual(1000);
  });

  it('accepts the result of an action whose widget stopped meanwhile', async () => {
    let finish: (value: unknown) => void = () => undefined;
    const { backends } = await host({
      builtins: counterBackend({
        bump: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      }),
    });
    startCounter(backends);
    const connection = backends.connection('fixture.widgets');
    const result = connection?.runAction(W, {
      actionId: 'a1',
      name: 'bump',
      params: { by: 1 },
      timeoutMs: 1000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    connection?.stopWidget(W);
    finish({ done: true });
    await expect(result).resolves.toEqual({ done: true });
  });

  it('lets running actions finish during the close grace', async () => {
    const { backends } = await host({
      builtins: counterBackend({
        bump: () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve('finished');
            }, 50);
          }),
      }),
    });
    startCounter(backends);
    const connection = backends.connection('fixture.widgets');
    const result = connection?.runAction(W, {
      actionId: 'a1',
      name: 'bump',
      params: { by: 1 },
      timeoutMs: 5000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await connection?.close(1000);
    await expect(result).resolves.toBe('finished');
  });

  it('answers an overlay request for a widget it does not run', async () => {
    let backendEnd: ChannelEnd | undefined;
    const received: unknown[] = [];
    await host({
      run: (channel) => {
        backendEnd = channel;
        channel.onMessage((message) => received.push(message));
        channel.send({ type: 'ready', widgets: { counter: { actions: [], migrates: false } } });
        return { close: () => undefined };
      },
    });
    backendEnd?.send({
      type: 'overlayAction',
      widgetId: 'zzzzzzzzzz99',
      requestId: 'r1',
      name: 'flash',
      params: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(received).toContainEqual(
      expect.objectContaining({ type: 'overlayActionResult', requestId: 'r1', ok: false }),
    );
  });

  it('migrates settings through the backend', async () => {
    const { backends } = await host({ builtins: counterBackend() });
    await expect(
      backends
        .connection('fixture.widgets')
        ?.migrate('counter', { label: 'Old', step: 2 }, '0.9.0', '1.0.0'),
    ).resolves.toEqual({ label: 'Migrated', step: 2 });
  });

  it('drops invalid messages, oversized state and widgets it was not started for', async () => {
    let backendEnd: ChannelEnd | undefined;
    const { backends, delegate } = await host({
      run: (channel) => {
        backendEnd = channel;
        channel.send({ type: 'ready', widgets: { counter: { actions: [], migrates: false } } });
        return { close: () => undefined };
      },
    });
    startCounter(backends);
    backendEnd?.send({ type: 'nope' });
    backendEnd?.send({ type: 'setState', widgetId: W, state: 'x'.repeat(1_100_000) });
    backendEnd?.send({ type: 'setState', widgetId: 'zzzzzzzzzz99', state: 1 });
    backendEnd?.send({ type: 'setState', widgetId: W, state: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(delegate.calls).toEqual([['setState', W, 2]]);
  });

  it('marks a plugin without a builtin backend as broken', async () => {
    const { registry, backends } = await host();
    expect(registry.plugin('fixture.widgets')).toMatchObject({
      status: 'broken',
      errors: ['backend not available'],
    });
    expect(backends.connection('fixture.widgets')).toBeUndefined();
  });

  it('marks a plugin broken when ready times out', async () => {
    const { registry } = await host({
      run: () => ({ close: () => undefined }),
      readyTimeoutMs: 50,
    });
    expect(registry.plugin('fixture.widgets')).toMatchObject({
      status: 'broken',
      errors: ['backend did not start within 0.05 s'],
    });
  });

  it('marks a plugin broken when ready lists an unknown action or type', async () => {
    const { registry } = await host({
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend({ actions: { explode: () => undefined } }),
            ghost: defineWidgetBackend({}),
          },
        }),
      },
    });
    expect(registry.plugin('fixture.widgets')?.errors).toEqual([
      'backend handles "counter:explode", which the manifest does not declare; backend declares the widget type "ghost", which the manifest does not declare',
    ]);
  });

  it('marks a plugin broken when an action has no handler and the type has no overlay', async () => {
    const manifest = fixtureManifest();
    const [counter] = manifest.widgets ?? [];
    const { registry } = await host({
      manifest: {
        ...manifest,
        widgets: [{ ...counter, type: 'counter', name: 'Counter', overlay: undefined }],
      },
    });
    expect(registry.plugin('fixture.widgets')?.errors).toEqual([
      'action "counter:bump" has no handler: add an overlay or handle it in the backend; action "counter:ping" has no handler: add an overlay or handle it in the backend',
    ]);
  });
});
