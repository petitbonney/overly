import type { ChannelEnd } from '@overly/shared';
import { describe, expect, it, vi } from 'vitest';

import { definePluginBackend, defineWidgetBackend, type WidgetContext } from './define.js';
import { runPluginBackend } from './runtime.js';

const W = 'abcdefghij12';
type Message = Record<string, unknown>;

function fakeChannel() {
  const sent: Message[] = [];
  let handler: ((message: unknown) => void) | undefined;
  const channel: ChannelEnd = {
    send: (message) => sent.push(JSON.parse(JSON.stringify(message)) as Message),
    onMessage: (next) => {
      handler = next;
    },
    close: vi.fn(),
  };
  const deliver = async (message: Message): Promise<void> => {
    handler?.(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const of = (type: string) => sent.filter((message) => message['type'] === type);
  return { channel, sent, deliver, of };
}

interface BannerState {
  visible: boolean;
  text: string;
}

function start(settings: Message = { size: 48 }, state: unknown = null): Message {
  return {
    type: 'start',
    widgetId: W,
    widgetType: 'banner',
    widget: { id: W, name: 'Banner' },
    settings,
    state,
  };
}

function action(name: string, params: Message = {}, callId = 'c1'): Message {
  return { type: 'action', widgetId: W, callId, actionId: `a-${callId}`, name, params };
}

describe('runPluginBackend', () => {
  it('announces the handled actions of each widget type', () => {
    const { channel, of } = fakeChannel();
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend({
            actions: { show: () => undefined, hide: () => undefined },
          }),
          plain: defineWidgetBackend({ migrateSettings: (settings) => settings }),
        },
      }),
      channel,
    );
    expect(of('ready')).toEqual([
      {
        type: 'ready',
        widgets: {
          banner: { actions: ['show', 'hide'], migrates: false },
          plain: { actions: [], migrates: true },
        },
      },
    ]);
  });

  it('runs an action with params, settings and the initial state', async () => {
    const { channel, deliver, of } = fakeChannel();
    const seen: unknown[] = [];
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend<{ size: number }, BannerState>({
            initialState: { visible: false, text: '' },
            actions: {
              show: (params, ctx, info) => {
                seen.push(params, ctx.settings, ctx.state, ctx.widget, info);
                return { shown: true };
              },
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start());
    await deliver(action('show', { text: 'hi' }));
    expect(seen).toEqual([
      { text: 'hi' },
      { size: 48 },
      { visible: false, text: '' },
      { id: W, name: 'Banner', type: 'banner' },
      { actionId: 'a-c1' },
    ]);
    expect(of('actionResult')).toEqual([
      { type: 'actionResult', widgetId: W, callId: 'c1', ok: true, result: { shown: true } },
    ]);
  });

  it('keeps a stored state instead of the initial one', async () => {
    const { channel, deliver } = fakeChannel();
    let state: unknown;
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend<Message, BannerState>({
            initialState: { visible: false, text: '' },
            onStart: (ctx) => {
              state = ctx.state;
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start({}, { visible: true, text: 'kept' }));
    expect(state).toEqual({ visible: true, text: 'kept' });
  });

  it('reports a thrown error as a failed actionResult', async () => {
    const { channel, deliver, of } = fakeChannel();
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend({
            actions: {
              show: () => {
                throw new Error('boom');
              },
              later: () => Promise.reject(new Error('later boom')),
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start());
    await deliver(action('show', {}, 'c1'));
    await deliver(action('later', {}, 'c2'));
    await deliver(action('missing', {}, 'c3'));
    expect(of('actionResult')).toEqual([
      { type: 'actionResult', widgetId: W, callId: 'c1', ok: false, error: 'boom' },
      { type: 'actionResult', widgetId: W, callId: 'c2', ok: false, error: 'later boom' },
      {
        type: 'actionResult',
        widgetId: W,
        callId: 'c3',
        ok: false,
        error: 'no handler for "missing"',
      },
    ]);
  });

  it('updates state and tells the host, and sends overlay messages and events', async () => {
    const { channel, deliver, of } = fakeChannel();
    let ctxState: unknown;
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend<Message, BannerState>({
            initialState: { visible: false, text: '' },
            actions: {
              show: (params, ctx) => {
                ctx.setState({ visible: true, text: String(params['text']) });
                ctxState = ctx.state;
                ctx.emitToOverlay('banner', ctx.state);
                ctx.emitEvent('banner.shown', { text: params['text'] });
              },
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start());
    await deliver(action('show', { text: 'hi' }));
    expect(ctxState).toEqual({ visible: true, text: 'hi' });
    expect(of('setState')).toEqual([
      { type: 'setState', widgetId: W, state: { visible: true, text: 'hi' } },
    ]);
    expect(of('emitToOverlay')).toEqual([
      {
        type: 'emitToOverlay',
        widgetId: W,
        name: 'banner',
        payload: { visible: true, text: 'hi' },
      },
    ]);
    expect(of('emitEvent')).toEqual([
      { type: 'emitEvent', widgetId: W, name: 'banner.shown', payload: { text: 'hi' } },
    ]);
  });

  it('resolves runOverlayAction from overlayActionResult and tags the callId', async () => {
    const { channel, deliver, of } = fakeChannel();
    const outcomes: unknown[] = [];
    runPluginBackend(
      definePluginBackend({
        widgets: {
          alerts: defineWidgetBackend({
            actions: {
              'show-alert': async (params, ctx) => {
                const outcome = await ctx.runOverlayAction('show-alert', params, {
                  timeoutMs: 5000,
                });
                outcomes.push(outcome);
                return outcome;
              },
            },
          }),
        },
      }),
      channel,
    );
    await deliver({ ...start(), widgetType: 'alerts' });
    await deliver(action('show-alert', { title: 'Hi' }, 'c7'));
    const [request] = of('overlayAction');
    expect(request).toMatchObject({
      widgetId: W,
      callId: 'c7',
      name: 'show-alert',
      params: { title: 'Hi' },
      timeoutMs: 5000,
    });
    await deliver({
      type: 'overlayActionResult',
      widgetId: W,
      requestId: request?.['requestId'],
      ok: true,
      delivered: true,
      result: { played: true },
    });
    expect(outcomes).toEqual([{ delivered: true, result: { played: true } }]);
    expect(of('actionResult')).toMatchObject([
      { ok: true, result: { delivered: true, result: { played: true } } },
    ]);
  });

  it('lets onOverlayConnect emit to that overlay only', async () => {
    const { channel, deliver, of } = fakeChannel();
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend<Message, BannerState>({
            initialState: { visible: true, text: 'still here' },
            onOverlayConnect: (ctx, overlay) => {
              if (!overlay.preview) overlay.emit('banner', ctx.state);
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start());
    await deliver({ type: 'overlayConnected', widgetId: W, overlayId: 'o1', preview: false });
    await deliver({ type: 'overlayConnected', widgetId: W, overlayId: 'o2', preview: true });
    expect(of('emitToOverlay')).toEqual([
      {
        type: 'emitToOverlay',
        widgetId: W,
        name: 'banner',
        payload: { visible: true, text: 'still here' },
        overlayId: 'o1',
      },
    ]);
  });

  it('applies new settings and calls onSettings with the previous ones', async () => {
    const { channel, deliver } = fakeChannel();
    const calls: unknown[] = [];
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend<{ size: number }>({
            onSettings: (ctx: WidgetContext<{ size: number }, null>, previous) => {
              calls.push([previous, ctx.settings]);
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start({ size: 48 }));
    await deliver({ type: 'settings', widgetId: W, settings: { size: 60 } });
    expect(calls).toEqual([[{ size: 48 }, { size: 60 }]]);
  });

  it('answers migrate with migrateResult', async () => {
    const { channel, deliver, of } = fakeChannel();
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend({
            migrateSettings: (settings, { from, to }) => ({
              ...settings,
              migrated: `${from}>${to}`,
            }),
          }),
        },
      }),
      channel,
    );
    await deliver({
      type: 'migrate',
      requestId: 'm1',
      widgetType: 'banner',
      settings: { a: 1 },
      from: '1.0.0',
      to: '2.0.0',
    });
    expect(of('migrateResult')).toEqual([
      {
        type: 'migrateResult',
        requestId: 'm1',
        ok: true,
        settings: { a: 1, migrated: '1.0.0>2.0.0' },
      },
    ]);
  });

  it('calls onStop and forgets the widget on stop', async () => {
    const { channel, deliver, of } = fakeChannel();
    const onStop = vi.fn();
    runPluginBackend(
      definePluginBackend({
        widgets: { banner: defineWidgetBackend({ onStop, actions: { show: () => 1 } }) },
      }),
      channel,
    );
    await deliver(start());
    await deliver({ type: 'stop', widgetId: W });
    await deliver(action('show'));
    expect(onStop).toHaveBeenCalledOnce();
    expect(of('actionResult')).toEqual([
      {
        type: 'actionResult',
        widgetId: W,
        callId: 'c1',
        ok: false,
        error: `widget ${W} is not started`,
      },
    ]);
  });

  it('logs a failing onStart and invalid host messages', async () => {
    const { channel, deliver, of } = fakeChannel();
    runPluginBackend(
      definePluginBackend({
        widgets: {
          banner: defineWidgetBackend({
            onStart: () => {
              throw new Error('cannot start');
            },
          }),
        },
      }),
      channel,
    );
    await deliver(start());
    await deliver({ type: 'nope' });
    expect(of('log')).toEqual([
      { type: 'log', widgetId: W, level: 'error', msg: 'onStart failed: cannot start' },
      { type: 'log', level: 'warn', msg: 'Ignored an invalid message from the host' },
    ]);
  });
});
