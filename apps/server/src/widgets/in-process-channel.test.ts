import { expect, it } from 'vitest';

import { createInProcessChannel } from './in-process-channel.js';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

it('delivers JSON copies in order, after the current call', async () => {
  const [host, backend] = createInProcessChannel();
  const received: unknown[] = [];
  backend.onMessage((message) => received.push(message));
  const original = { at: new Date('2026-10-15T08:00:00.000Z'), drop: () => 1, list: [1] };
  host.send(original);
  host.send({ n: 2 });
  expect(received).toEqual([]);
  await tick();
  expect(received).toEqual([{ at: '2026-10-15T08:00:00.000Z', list: [1] }, { n: 2 }]);
  original.list.push(2);
  expect(received[0]).toEqual({ at: '2026-10-15T08:00:00.000Z', list: [1] });
});

it('works in both directions', async () => {
  const [host, backend] = createInProcessChannel();
  const received: unknown[] = [];
  host.onMessage((message) => received.push(message));
  backend.send({ type: 'ready' });
  await tick();
  expect(received).toEqual([{ type: 'ready' }]);
});

it('throws on the sending side for values JSON cannot carry', () => {
  const [host] = createInProcessChannel();
  expect(() => {
    host.send({ big: 1n });
  }).toThrow();
});

it('drops messages after close', async () => {
  const [host, backend] = createInProcessChannel();
  const received: unknown[] = [];
  backend.onMessage((message) => received.push(message));
  host.send({ n: 1 });
  host.close();
  host.send({ n: 2 });
  backend.send({ n: 3 });
  await tick();
  expect(received).toEqual([]);
});
