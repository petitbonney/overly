import { expect, it } from 'vitest';

import { BackendToHostMessageSchema, HostToBackendMessageSchema } from './backend-protocol.js';

const widgetId = 'abcdefghij12';

it('parses every host message', () => {
  const messages = [
    {
      type: 'start',
      widgetId,
      widgetType: 'banner',
      widget: { id: widgetId, name: 'Banner' },
      settings: {},
      state: null,
    },
    { type: 'settings', widgetId, settings: { a: 1 } },
    { type: 'action', widgetId, callId: 'c1', actionId: 'a1', name: 'show', params: {} },
    { type: 'overlayConnected', widgetId, overlayId: 'o1', preview: false },
    { type: 'overlayActionResult', widgetId, requestId: 'r1', ok: true, delivered: false },
    { type: 'overlayActionResult', widgetId, requestId: 'r1', ok: false, error: 'timeout' },
    {
      type: 'migrate',
      requestId: 'r2',
      widgetType: 'banner',
      settings: {},
      from: '1.0.0',
      to: '2.0.0',
    },
    { type: 'stop', widgetId },
  ];
  for (const message of messages) {
    expect(HostToBackendMessageSchema.safeParse(message).success).toBe(true);
  }
});

it('parses every backend message', () => {
  const messages = [
    { type: 'ready', widgets: { banner: { actions: ['show'], migrates: false } } },
    { type: 'actionResult', widgetId, callId: 'c1', ok: true, result: { a: 1 } },
    { type: 'actionResult', widgetId, callId: 'c1', ok: false, error: 'boom' },
    { type: 'setState', widgetId, state: { visible: true } },
    { type: 'emitToOverlay', widgetId, name: 'banner', payload: {}, overlayId: 'o1' },
    { type: 'overlayAction', widgetId, requestId: 'r1', callId: 'c1', name: 'show', params: {} },
    { type: 'emitEvent', widgetId, name: 'alert.finished', payload: {} },
    { type: 'log', level: 'warn', msg: 'careful', data: { a: 1 } },
    { type: 'migrateResult', requestId: 'r2', ok: true, settings: {} },
  ];
  for (const message of messages) {
    expect(BackendToHostMessageSchema.safeParse(message).success).toBe(true);
  }
});

it('rejects unknown types, non-JSON state and bad log levels', () => {
  expect(BackendToHostMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  expect(HostToBackendMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
  expect(
    BackendToHostMessageSchema.safeParse({ type: 'setState', widgetId, state: undefined }).success,
  ).toBe(false);
  expect(
    BackendToHostMessageSchema.safeParse({ type: 'log', level: 'fatal', msg: 'x' }).success,
  ).toBe(false);
});
