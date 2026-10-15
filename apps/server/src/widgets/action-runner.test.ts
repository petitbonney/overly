import { definePluginBackend, defineWidgetBackend } from '@overly/sdk/backend';
import type { ServerMessage } from '@overly/shared';
import { describe, expect, it, vi } from 'vitest';

import { fixtureManifest, type ManifestInput } from '../testing/plugins.js';
import {
  counterDoc,
  createTestServices,
  TEST_WIDGET_ID as W,
  type TestServices,
} from '../testing/services.js';
import type { OverlaySocket } from './overlay-hub.js';
import { WidgetServiceError } from './service.js';

class FakeSocket implements OverlaySocket {
  readonly sent: Record<string, unknown>[] = [];
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    // Not needed.
  }
  actions(): Record<string, unknown>[] {
    return this.sent.filter((message) => message['type'] === 'action');
  }
}

const widgetFiles = { [`${W}.json`]: JSON.stringify(counterDoc()) };

function counterWith(
  change: (widget: Record<string, unknown>) => Record<string, unknown>,
): ManifestInput {
  const manifest = fixtureManifest();
  const [counter] = (manifest.widgets ?? []) as Record<string, unknown>[];
  return { ...manifest, widgets: [change(counter ?? {})] } as ManifestInput;
}

function withActions(actions: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  return counterWith((counter) => ({
    ...counter,
    ...extra,
    actions: [...(counter['actions'] as Record<string, unknown>[]), ...actions],
  }));
}

/** Services with a live overlay socket that answers only when told to. */
async function withOverlay(options: Parameters<typeof createTestServices>[0] = {}) {
  const services = await createTestServices({ widgetFiles, ...options });
  const socket = new FakeSocket();
  const connection = services.overlays.attach(W, socket, false);
  services.service.overlayAttached(connection);
  const answer = (index: number, message: Record<string, unknown> = {}) => {
    const action = socket.actions()[index];
    services.overlays.handleMessage(
      connection.id,
      JSON.stringify({ type: 'actionDone', id: action?.['id'], ...message }),
    );
  };
  return { ...services, socket, answer };
}

function actionMessages(services: TestServices, actionId?: string): ServerMessage[] {
  return services.messages.filter(
    (message) =>
      message.type === 'widget.action' && (actionId === undefined || message.actionId === actionId),
  );
}

async function serviceError(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

describe('running actions', () => {
  it('runs queued actions one after another', async () => {
    const services = await withOverlay();
    const run = () => services.service.runAction(W, 'bump', { params: { by: 1 }, priority: 0 });
    const responses = [await run(), await run(), await run()];
    expect(responses.map((response) => response.status)).toEqual(['running', 'queued', 'queued']);
    expect(services.socket.actions()).toHaveLength(1);
    services.answer(0);
    await vi.waitFor(() => {
      expect(services.socket.actions()).toHaveLength(2);
    });
    services.answer(1);
    await vi.waitFor(() => {
      expect(services.socket.actions()).toHaveLength(3);
    });
    expect(services.socket.actions().map((action) => action['params'])).toEqual([
      { by: 1 },
      { by: 1 },
      { by: 1 },
    ]);
  });

  it('runs non-queued actions at once', async () => {
    const services = await withOverlay();
    await services.service.runAction(W, 'ping', { params: {}, priority: 0 });
    await services.service.runAction(W, 'ping', { params: {}, priority: 0 });
    expect(services.socket.actions()).toHaveLength(2);
  });

  it('fills param defaults and rejects invalid params with issues', async () => {
    const services = await withOverlay({
      manifest: withActions([
        {
          name: 'greet',
          title: 'Greet',
          params: { type: 'object', properties: { name: { type: 'string', default: 'you' } } },
        },
      ]),
    });
    await services.service.runAction(W, 'greet', { params: {}, priority: 0 });
    expect(services.socket.actions()[0]?.['params']).toEqual({ name: 'you' });
    const error = await serviceError(
      services.service.runAction(W, 'bump', { params: {}, priority: 0 }),
    );
    expect(error).toBeInstanceOf(WidgetServiceError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_params', issues: [{ path: 'by' }] });
  });

  it.each([
    ['widget_not_found', 404],
    ['widget_disabled', 409],
    ['widget_broken', 409],
    ['action_not_found', 404],
  ])('answers %s', async (code, status) => {
    const doc =
      code === 'widget_broken'
        ? counterDoc({ settings: { label: 'x', step: 99 } })
        : counterDoc({ enabled: code !== 'widget_disabled' });
    const { service } = await createTestServices({
      widgetFiles: { [`${W}.json`]: JSON.stringify(doc) },
    });
    const id = code === 'widget_not_found' ? 'zzzzzzzzzz99' : W;
    const action = code === 'action_not_found' ? 'nope' : 'bump';
    const error = await serviceError(
      service.runAction(id, action, { params: { by: 1 }, priority: 0 }),
    );
    expect(error).toMatchObject({ status, code });
  });

  it('answers 429 queue_full', async () => {
    const services = await withOverlay({
      manifest: counterWith((counter) => ({ ...counter, queue: { maxLength: 1 } })),
    });
    const run = () => services.service.runAction(W, 'bump', { params: { by: 1 }, priority: 0 });
    await run();
    await run();
    expect(await serviceError(run())).toMatchObject({ status: 429, code: 'queue_full' });
  });

  it('finishes with the no_overlay warning when nothing is connected', async () => {
    const services = await createTestServices({ widgetFiles });
    const { actionId } = await services.service.runAction(W, 'ping', { params: {}, priority: 0 });
    await vi.waitFor(() => {
      expect(actionMessages(services, actionId).at(-1)).toEqual({
        type: 'widget.action',
        widgetId: W,
        actionId,
        action: 'ping',
        status: 'done',
        warnings: ['no_overlay'],
      });
    });
  });

  it('routes to the backend when it handles the action', async () => {
    const services = await withOverlay({
      manifest: fixtureManifest({ backend: 'src/backend.js' }),
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: { counter: defineWidgetBackend({ actions: { bump: (params) => params } }) },
        }),
      },
    });
    const { actionId } = await services.service.runAction(W, 'bump', {
      params: { by: 4 },
      priority: 0,
    });
    await vi.waitFor(() => {
      expect(actionMessages(services, actionId).at(-1)).toMatchObject({
        status: 'done',
        warnings: [],
      });
    });
    expect(services.socket.actions()).toEqual([]);
  });

  it('attaches no_overlay to a backend action whose overlay action was not delivered', async () => {
    const services = await createTestServices({
      widgetFiles,
      manifest: fixtureManifest({ backend: 'src/backend.js' }),
      builtins: {
        'fixture.widgets': definePluginBackend({
          widgets: {
            counter: defineWidgetBackend({
              actions: { bump: (params, ctx) => ctx.runOverlayAction('flash', params) },
            }),
          },
        }),
      },
    });
    const { actionId } = await services.service.runAction(W, 'bump', {
      params: { by: 1 },
      priority: 0,
    });
    await vi.waitFor(() => {
      expect(actionMessages(services, actionId).at(-1)).toMatchObject({
        status: 'done',
        warnings: ['no_overlay'],
      });
    });
  });

  it('fails an action whose result breaks the output schema', async () => {
    const services = await withOverlay({
      manifest: withActions([
        {
          name: 'measure',
          title: 'Measure',
          output: {
            type: 'object',
            properties: { n: { type: 'integer' } },
            required: ['n'],
          },
        },
      ]),
    });
    const { actionId } = await services.service.runAction(W, 'measure', {
      params: {},
      priority: 0,
    });
    services.answer(0, { result: { n: 'many' } });
    await vi.waitFor(() => {
      expect(actionMessages(services, actionId).at(-1)).toMatchObject({
        status: 'failed',
        error: expect.stringMatching(/^invalid_output: n: /) as unknown,
      });
    });
  });

  it('fails with timeout and starts the next action', async () => {
    const services = await withOverlay({
      manifest: counterWith((counter) => ({
        ...counter,
        actions: [
          {
            name: 'bump',
            title: 'Bump',
            queued: true,
            timeoutMs: 100,
            params: { type: 'object', properties: { by: { type: 'integer' } } },
          },
        ],
      })),
    });
    const first = await services.service.runAction(W, 'bump', { params: {}, priority: 0 });
    await services.service.runAction(W, 'bump', { params: {}, priority: 0 });
    await vi.waitFor(() => {
      expect(actionMessages(services, first.actionId).at(-1)).toMatchObject({
        status: 'failed',
        error: 'timeout',
      });
    });
    await vi.waitFor(() => {
      expect(services.socket.actions()).toHaveLength(2);
    });
  });

  it('cancels pending actions when the widget is disabled', async () => {
    const services = await withOverlay();
    await services.service.runAction(W, 'bump', { params: { by: 1 }, priority: 0 });
    const second = await services.service.runAction(W, 'bump', { params: { by: 2 }, priority: 0 });
    await services.service.update(W, { enabled: false });
    expect(actionMessages(services, second.actionId).at(-1)).toMatchObject({ status: 'cancelled' });
  });

  it('broadcasts queued, running, done and runtime messages in order', async () => {
    const services = await withOverlay();
    services.messages.length = 0;
    const { actionId } = await services.service.runAction(W, 'bump', {
      params: { by: 1 },
      priority: 0,
    });
    services.answer(0);
    await vi.waitFor(() => {
      expect(actionMessages(services, actionId).at(-1)).toMatchObject({ status: 'done' });
    });
    expect(
      services.messages.map((message) =>
        message.type === 'widget.action'
          ? message.status
          : message.type === 'widget.runtime'
            ? `runtime:${String(message.runtime.queue.running)}`
            : message.type,
      ),
    ).toEqual(['queued', 'running', 'runtime:bump', 'done', 'runtime:null']);
  });
});
