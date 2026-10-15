import { describe, expect, it } from 'vitest';

import { ActionQueue, QueueFullError } from './queue.js';

interface Deferred {
  promise: Promise<string>;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: (value: string) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** A queue whose items record when they start and finish when told to. */
function harness(maxLength = 10) {
  const started: string[] = [];
  const gates = new Map<string, Deferred>();
  const snapshots: { pending: number; running: string | null }[] = [];
  const queue = new ActionQueue({
    maxLength,
    onChange: (snapshot) => snapshots.push(snapshot),
  });
  const push = (name: string, priority = 0) => {
    const gate = deferred();
    gates.set(name, gate);
    return queue.push({
      name,
      priority,
      run: () => {
        started.push(name);
        return gate.promise;
      },
    });
  };
  const finish = async (name: string) => {
    gates.get(name)?.resolve(`${name} done`);
    await tick();
  };
  return { queue, push, finish, started, snapshots, gates };
}

describe('ActionQueue', () => {
  it('runs one item at a time', async () => {
    const { push, finish, started } = harness();
    const first = push('a');
    void push('b');
    await tick();
    expect(started).toEqual(['a']);
    await finish('a');
    expect(await first).toEqual({ status: 'completed', value: 'a done' });
    expect(started).toEqual(['a', 'b']);
  });

  it('orders waiting items by priority, then arrival', async () => {
    const { push, finish, started } = harness();
    void push('a');
    void push('low', 0);
    void push('high', 5);
    void push('mid', 1);
    void push('high2', 5);
    for (const name of ['a', 'high', 'high2', 'mid']) await finish(name);
    expect(started).toEqual(['a', 'high', 'high2', 'mid', 'low']);
  });

  it('rejects a push beyond maxLength pending items', async () => {
    const { push } = harness(2);
    void push('running');
    void push('one');
    void push('two');
    await tick();
    expect(() => push('three')).toThrow(QueueFullError);
  });

  it('moves on after a failure', async () => {
    const { push, gates, finish, started } = harness();
    const first = push('a');
    const second = push('b');
    gates.get('a')?.reject(new Error('boom'));
    await tick();
    expect(await first).toMatchObject({ status: 'failed', error: new Error('boom') });
    await finish('b');
    expect(await second).toEqual({ status: 'completed', value: 'b done' });
    expect(started).toEqual(['a', 'b']);
  });

  it('cancels pending items but lets the running one finish', async () => {
    const { queue, push, finish, started } = harness();
    const running = push('a');
    const pending = push('b');
    queue.cancelAll();
    expect(await pending).toEqual({ status: 'cancelled' });
    expect(queue.pending).toBe(0);
    await finish('a');
    expect(await running).toEqual({ status: 'completed', value: 'a done' });
    expect(started).toEqual(['a']);
  });

  it('reports pending and running on every change', async () => {
    const { queue, push, finish, snapshots } = harness();
    void push('a');
    void push('b');
    expect(queue.running).toBe('a');
    expect(queue.pending).toBe(1);
    await finish('a');
    await finish('b');
    expect(snapshots).toEqual([
      { pending: 0, running: 'a' },
      { pending: 1, running: 'a' },
      { pending: 0, running: 'b' },
      { pending: 0, running: null },
    ]);
  });
});
