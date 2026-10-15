import { expect, it } from 'vitest';

import { OverlayClientMessageSchema, OverlayServerMessageSchema } from './overlay-protocol.js';

it('parses every server message', () => {
  const messages = [
    {
      type: 'init',
      widget: { id: 'abcdefghij12', name: 'Alerts', type: 'overly.alerts:alerts' },
      active: true,
      settings: { volume: 80 },
    },
    { type: 'settings', settings: {} },
    { type: 'widget', name: 'Alerts', active: false },
    { type: 'action', id: 'd1', name: 'show-alert', params: { title: 'Hi' } },
    { type: 'message', name: 'banner', payload: { visible: true } },
  ];
  for (const message of messages) {
    expect(OverlayServerMessageSchema.parse(message)).toEqual(message);
  }
});

it('parses actionDone and actionFailed', () => {
  expect(OverlayClientMessageSchema.parse({ type: 'actionDone', id: 'd1' })).toEqual({
    type: 'actionDone',
    id: 'd1',
  });
  expect(
    OverlayClientMessageSchema.parse({ type: 'actionFailed', id: 'd1', error: 'boom' }),
  ).toMatchObject({ error: 'boom' });
});

it('rejects a 501-character error and unknown messages', () => {
  expect(
    OverlayClientMessageSchema.safeParse({ type: 'actionFailed', id: 'd1', error: 'x'.repeat(501) })
      .success,
  ).toBe(false);
  expect(OverlayClientMessageSchema.safeParse({ type: 'hello' }).success).toBe(false);
  expect(OverlayClientMessageSchema.safeParse({ type: 'actionDone' }).success).toBe(false);
});
