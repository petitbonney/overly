import { expect, it } from 'vitest';

import { ServerMessageSchema, WS_CLOSE_SHUTDOWN } from './messages.js';

it('parses hello', () => {
  expect(ServerMessageSchema.parse({ type: 'hello', version: '0.0.0' })).toEqual({
    type: 'hello',
    version: '0.0.0',
  });
});

it('rejects unknown message types', () => {
  expect(ServerMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
});

it('closes sockets with 1001 on shutdown', () => {
  expect(WS_CLOSE_SHUTDOWN).toBe(1001);
});

it('parses the widget messages', () => {
  expect(ServerMessageSchema.parse({ type: 'widgets.changed' })).toEqual({
    type: 'widgets.changed',
  });
  expect(
    ServerMessageSchema.parse({
      type: 'widget.runtime',
      widgetId: 'abcdefghij12',
      runtime: { overlays: { live: 1, preview: 1 }, queue: { pending: 0, running: null } },
    }),
  ).toMatchObject({ type: 'widget.runtime' });
  expect(
    ServerMessageSchema.parse({
      type: 'widget.action',
      widgetId: 'abcdefghij12',
      actionId: 'a1',
      action: 'show-alert',
      status: 'done',
    }),
  ).toMatchObject({ warnings: [] });
  expect(
    ServerMessageSchema.safeParse({
      type: 'widget.action',
      widgetId: 'abcdefghij12',
      actionId: 'a1',
      action: 'show-alert',
      status: 'exploded',
    }).success,
  ).toBe(false);
});
