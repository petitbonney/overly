import { type ChannelEnd, runPluginBackend } from '@overly/sdk/backend';
import { expect, it } from 'vitest';

import backend from './backend.js';

const W = 'abcdefghij12';
type Message = Record<string, unknown>;

function harness() {
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
  return { send, of };
}

async function started(state: unknown = null) {
  const backendHarness = harness();
  await backendHarness.send({
    type: 'start',
    widgetId: W,
    widgetType: 'banner',
    widget: { id: W, name: 'Banner' },
    settings: {},
    state,
  });
  return backendHarness;
}

it('handles show and hide', () => {
  const { of } = harness();
  expect(of('ready')).toEqual([
    { type: 'ready', widgets: { banner: { actions: ['show', 'hide'], migrates: false } } },
  ]);
});

it('show saves the state and sends it to the overlays', async () => {
  const { send, of } = await started();
  await send({
    type: 'action',
    widgetId: W,
    callId: 'c1',
    actionId: 'a1',
    name: 'show',
    params: { text: 'Hi chat' },
  });
  expect(of('setState')).toEqual([
    { type: 'setState', widgetId: W, state: { visible: true, text: 'Hi chat' } },
  ]);
  expect(of('emitToOverlay')).toEqual([
    {
      type: 'emitToOverlay',
      widgetId: W,
      name: 'banner',
      payload: { visible: true, text: 'Hi chat' },
    },
  ]);
  expect(of('actionResult')).toEqual([
    { type: 'actionResult', widgetId: W, callId: 'c1', ok: true },
  ]);
});

it('hide keeps the text and hides', async () => {
  const { send, of } = await started({ visible: true, text: 'Hi chat' });
  await send({
    type: 'action',
    widgetId: W,
    callId: 'c1',
    actionId: 'a1',
    name: 'hide',
    params: {},
  });
  expect(of('setState')).toEqual([
    { type: 'setState', widgetId: W, state: { visible: false, text: 'Hi chat' } },
  ]);
});

it('sends the current state to an overlay that connects', async () => {
  const { send, of } = await started({ visible: true, text: 'Still here' });
  await send({ type: 'overlayConnected', widgetId: W, overlayId: 'o1', preview: false });
  expect(of('emitToOverlay')).toEqual([
    {
      type: 'emitToOverlay',
      widgetId: W,
      name: 'banner',
      payload: { visible: true, text: 'Still here' },
      overlayId: 'o1',
    },
  ]);
});

it('starts hidden when nothing was shown yet', async () => {
  const { send, of } = await started();
  await send({ type: 'overlayConnected', widgetId: W, overlayId: 'o1', preview: true });
  expect(of('emitToOverlay')[0]?.['payload']).toEqual({ visible: false, text: '' });
});
