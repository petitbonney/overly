import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OverlayActionError, OverlayHub, type OverlaySocket } from './overlay-hub.js';

const W = 'abcdefghij12';

class FakeSocket implements OverlaySocket {
  readonly sent: Record<string, unknown>[] = [];
  closed: { code: number; reason: string } | undefined;
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  lastAction(): Record<string, unknown> | undefined {
    return this.sent.filter((message) => message['type'] === 'action').at(-1);
  }
}

function setup() {
  const counts: [string, { live: number; preview: number }][] = [];
  const hub = new OverlayHub({
    logger: pino({ level: 'silent' }),
    onCountsChange: (widgetId, value) => counts.push([widgetId, value]),
  });
  return { hub, counts };
}

function answer(hub: OverlayHub, connectionId: string, message: Record<string, unknown>): void {
  hub.handleMessage(connectionId, JSON.stringify(message));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('OverlayHub', () => {
  it('resolves undelivered at once when no overlay is connected', async () => {
    const { hub } = setup();
    await expect(hub.runAction(W, 'show', {}, 1000)).resolves.toEqual({ delivered: false });
  });

  it('sends the action to live and preview overlays with one delivery ID', () => {
    const { hub } = setup();
    const live = new FakeSocket();
    const preview = new FakeSocket();
    hub.attach(W, live, false);
    hub.attach(W, preview, true);
    hub.attach('zzzzzzzzzz99', new FakeSocket(), false);
    void hub.runAction(W, 'show', { text: 'hi' }, 1000);
    expect(live.lastAction()).toMatchObject({
      type: 'action',
      name: 'show',
      params: { text: 'hi' },
    });
    expect(preview.lastAction()?.['id']).toBe(live.lastAction()?.['id']);
  });

  it('resolves with the first actionDone and ignores later answers', async () => {
    const { hub } = setup();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const ca = hub.attach(W, a, false);
    const cb = hub.attach(W, b, true);
    const result = hub.runAction(W, 'show', {}, 1000);
    const id = a.lastAction()?.['id'];
    answer(hub, cb.id, { type: 'actionDone', id, result: { from: 'preview' } });
    answer(hub, ca.id, { type: 'actionFailed', id, error: 'late' });
    await expect(result).resolves.toEqual({ delivered: true, result: { from: 'preview' } });
  });

  it('succeeds when one overlay fails and another finishes', async () => {
    const { hub } = setup();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const ca = hub.attach(W, a, false);
    const cb = hub.attach(W, b, false);
    const result = hub.runAction(W, 'show', {}, 1000);
    const id = a.lastAction()?.['id'];
    answer(hub, ca.id, { type: 'actionFailed', id, error: 'autoplay blocked' });
    answer(hub, cb.id, { type: 'actionDone', id });
    await expect(result).resolves.toEqual({ delivered: true, result: undefined });
  });

  it('fails with the first error when every overlay fails', async () => {
    const { hub } = setup();
    const a = new FakeSocket();
    const b = new FakeSocket();
    const ca = hub.attach(W, a, false);
    const cb = hub.attach(W, b, false);
    const result = hub.runAction(W, 'show', {}, 1000);
    const id = a.lastAction()?.['id'];
    answer(hub, ca.id, { type: 'actionFailed', id, error: 'first' });
    hub.detach(cb.id);
    await expect(result).rejects.toEqual(new OverlayActionError('first'));
  });

  it('resolves undelivered when every overlay disconnects', async () => {
    const { hub } = setup();
    const ca = hub.attach(W, new FakeSocket(), false);
    const cb = hub.attach(W, new FakeSocket(), true);
    const result = hub.runAction(W, 'show', {}, 1000);
    hub.detach(ca.id);
    hub.detach(cb.id);
    await expect(result).resolves.toEqual({ delivered: false });
  });

  it('fails with timeout', async () => {
    vi.useFakeTimers();
    const { hub } = setup();
    hub.attach(W, new FakeSocket(), false);
    const result = hub.runAction(W, 'show', {}, 1000);
    vi.advanceTimersByTime(1000);
    await expect(result).rejects.toEqual(new OverlayActionError('timeout'));
  });

  it('ignores invalid and unknown client messages', async () => {
    const { hub } = setup();
    const socket = new FakeSocket();
    const connection = hub.attach(W, socket, false);
    const result = hub.runAction(W, 'show', {}, 1000);
    hub.handleMessage(connection.id, 'not json');
    answer(hub, connection.id, { type: 'hello' });
    answer(hub, connection.id, { type: 'actionDone', id: 'unknown' });
    answer(hub, 'unknown-connection', { type: 'actionDone', id: socket.lastAction()?.['id'] });
    answer(hub, connection.id, { type: 'actionDone', id: socket.lastAction()?.['id'], result: 1 });
    await expect(result).resolves.toEqual({ delivered: true, result: 1 });
  });

  it('a reconnected overlay receives the next action', async () => {
    const { hub } = setup();
    const before = hub.attach(W, new FakeSocket(), false);
    const first = hub.runAction(W, 'show-alert', { title: 'one' }, 1000);
    hub.detach(before.id);
    await expect(first).resolves.toEqual({ delivered: false });

    const socket = new FakeSocket();
    const after = hub.attach(W, socket, false);
    const second = hub.runAction(W, 'show-alert', { title: 'two' }, 1000);
    expect(socket.lastAction()).toMatchObject({ params: { title: 'two' } });
    answer(hub, after.id, { type: 'actionDone', id: socket.lastAction()?.['id'] });
    await expect(second).resolves.toEqual({ delivered: true, result: undefined });
  });

  it('sends messages to every overlay of a widget or to one connection', () => {
    const { hub } = setup();
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attach(W, a, false);
    const cb = hub.attach(W, b, true);
    hub.send(W, { type: 'settings', settings: { x: 1 } });
    hub.send(W, { type: 'message', name: 'banner', payload: 1 }, cb.id);
    expect(a.sent).toEqual([{ type: 'settings', settings: { x: 1 } }]);
    expect(b.sent).toEqual([
      { type: 'settings', settings: { x: 1 } },
      { type: 'message', name: 'banner', payload: 1 },
    ]);
  });

  it('reports live and preview counts', () => {
    const { hub, counts } = setup();
    const ca = hub.attach(W, new FakeSocket(), false);
    hub.attach(W, new FakeSocket(), true);
    hub.detach(ca.id);
    expect(hub.counts(W)).toEqual({ live: 0, preview: 1 });
    expect(counts).toEqual([
      [W, { live: 1, preview: 0 }],
      [W, { live: 1, preview: 1 }],
      [W, { live: 0, preview: 1 }],
    ]);
  });

  it('closes the sockets of a widget and forgets them', () => {
    const { hub } = setup();
    const socket = new FakeSocket();
    hub.attach(W, socket, false);
    hub.closeWidget(W, 4404, 'widget deleted');
    expect(socket.closed).toEqual({ code: 4404, reason: 'widget deleted' });
    expect(hub.counts(W)).toEqual({ live: 0, preview: 0 });
  });
});
