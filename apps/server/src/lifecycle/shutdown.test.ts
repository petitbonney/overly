import { describe, expect, it, type Mock, vi } from 'vitest';

import { type ShutdownLogger, ShutdownCoordinator } from './shutdown.js';

function logger(): { info: Mock<ShutdownLogger['info']>; error: Mock<ShutdownLogger['error']> } {
  return { info: vi.fn(), error: vi.fn() };
}

describe('ShutdownCoordinator', () => {
  it('runs steps in the order they were added', async () => {
    const order: string[] = [];
    const shutdown = new ShutdownCoordinator({ logger: logger() });
    shutdown.add('websockets', () => {
      order.push('websockets');
    });
    shutdown.add('http', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('http');
    });
    shutdown.add('logger', () => {
      order.push('logger');
    });
    expect(await shutdown.run('test')).toEqual({ exitCode: 0 });
    expect(order).toEqual(['websockets', 'http', 'logger']);
  });

  it('runs steps once even when run() is called twice', async () => {
    const step = vi.fn();
    const shutdown = new ShutdownCoordinator({ logger: logger() });
    shutdown.add('only', step);
    expect(shutdown.started).toBe(false);
    const first = shutdown.run('one');
    const second = shutdown.run('two');
    expect(shutdown.started).toBe(true);
    expect(second).toBe(first);
    await first;
    expect(step).toHaveBeenCalledOnce();
  });

  it('continues after a failing step and exits with 1', async () => {
    const after = vi.fn();
    const log = logger();
    const shutdown = new ShutdownCoordinator({ logger: log });
    shutdown.add('broken', () => {
      throw new Error('broken');
    });
    shutdown.add('after', after);
    expect(await shutdown.run('test')).toEqual({ exitCode: 1 });
    expect(after).toHaveBeenCalledOnce();
    expect(log.error).toHaveBeenCalled();
  });

  it('gives up after the deadline and exits with 1', async () => {
    const shutdown = new ShutdownCoordinator({ logger: logger(), deadlineMs: 20 });
    shutdown.add('stuck', () => new Promise(() => undefined));
    const started = Date.now();
    expect(await shutdown.run('test')).toEqual({ exitCode: 1 });
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
