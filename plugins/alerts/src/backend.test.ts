import { type ChannelEnd, runPluginBackend } from '@overly/sdk/backend';
import { expect, it } from 'vitest';

import backend from './backend.js';

const W = 'abcdefghij12';
type Message = Record<string, unknown>;
const alert = { title: 'Ada just followed!', message: 'Thanks!', variant: 'follow' };

async function started() {
  const sent: Message[] = [];
  let deliver: ((message: unknown) => void) | undefined;
  const channel: ChannelEnd = {
    send: (message) => sent.push(JSON.parse(JSON.stringify(message)) as Message),
    onMessage: (handler) => {
      deliver = handler;
    },
    close: () => undefined,
  };
  runPluginBackend(backend, channel);
  const send = async (message: Message) => {
    deliver?.(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const of = (type: string) => sent.filter((message) => message['type'] === type);
  await send({
    type: 'start',
    widgetId: W,
    widgetType: 'alerts',
    widget: { id: W, name: 'Alerts' },
    settings: {},
    state: null,
  });
  await send({
    type: 'action',
    widgetId: W,
    callId: 'c1',
    actionId: 'a1',
    name: 'show-alert',
    params: alert,
  });
  const [request] = of('overlayAction');
  const answer = (outcome: Message) =>
    send({
      type: 'overlayActionResult',
      widgetId: W,
      requestId: request?.['requestId'],
      ok: true,
      ...outcome,
    });
  return { of, request, answer };
}

it('forwards show-alert to the overlay', async () => {
  const { request } = await started();
  expect(request).toMatchObject({ callId: 'c1', name: 'show-alert', params: alert });
});

it('emits alert.finished after the overlay played it', async () => {
  const { of, answer } = await started();
  await answer({ delivered: true });
  expect(of('emitEvent')).toEqual([
    { type: 'emitEvent', widgetId: W, name: 'alert.finished', payload: alert },
  ]);
  expect(of('actionResult')).toEqual([
    { type: 'actionResult', widgetId: W, callId: 'c1', ok: true },
  ]);
});

it('does not emit alert.finished when no overlay played it', async () => {
  const { of, answer } = await started();
  await answer({ delivered: false });
  expect(of('emitEvent')).toEqual([]);
  expect(of('actionResult')).toEqual([
    { type: 'actionResult', widgetId: W, callId: 'c1', ok: true, result: { delivered: false } },
  ]);
});
