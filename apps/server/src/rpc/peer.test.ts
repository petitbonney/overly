import { PassThrough, Writable } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { RpcError, type RpcLogger, RpcPeer } from './peer.js';

function setup(options: { requestTimeoutMs?: number } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const logger = { warn: vi.fn<RpcLogger['warn']>(), error: vi.fn<RpcLogger['error']>() };
  const peer = new RpcPeer(input, output, { logger, ...options });

  const lines: unknown[] = [];
  const waiters: ((line: unknown) => void)[] = [];
  let buffered = '';
  output.setEncoding('utf8');
  output.on('data', (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf('\n');
    while (newline !== -1) {
      const line: unknown = JSON.parse(buffered.slice(0, newline));
      buffered = buffered.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
      newline = buffered.indexOf('\n');
    }
  });
  const next = (): Promise<unknown> =>
    lines.length > 0
      ? Promise.resolve(lines.shift())
      : new Promise((resolve) => {
          waiters.push(resolve);
        });
  const send = (message: unknown): void => {
    input.write(`${JSON.stringify(message)}\n`);
  };
  return { input, output, peer, logger, next, send };
}

describe('RpcPeer', () => {
  it('answers a request with the handler result', async () => {
    const { peer, next, send } = setup();
    peer.handle('ping', () => ({ ok: true }));
    send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(await next()).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('passes params and answers null for handlers without a result', async () => {
    const { peer, next, send } = setup();
    const handler = vi.fn();
    peer.handle('set', handler);
    send({ jsonrpc: '2.0', id: 'a', method: 'set', params: { x: 1 } });
    expect(await next()).toEqual({ jsonrpc: '2.0', id: 'a', result: null });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
  });

  it('answers unknown methods with -32601', async () => {
    const { next, send } = setup();
    send({ jsonrpc: '2.0', id: 1, method: 'nope' });
    expect(await next()).toMatchObject({ id: 1, error: { code: -32601 } });
  });

  it('answers -32603 when a handler throws', async () => {
    const { peer, next, send } = setup();
    peer.handle('boom', () => {
      throw new Error('boom');
    });
    send({ jsonrpc: '2.0', id: 1, method: 'boom' });
    expect(await next()).toEqual({
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32603, message: 'boom' },
    });
  });

  it('uses the code of a thrown RpcError', async () => {
    const { peer, next, send } = setup();
    peer.handle('strict', () => Promise.reject(new RpcError(-32602, 'bad params')));
    send({ jsonrpc: '2.0', id: 1, method: 'strict' });
    expect(await next()).toMatchObject({ error: { code: -32602, message: 'bad params' } });
  });

  it('skips and logs malformed lines, then keeps working', async () => {
    const { input, peer, logger, next, send } = setup();
    peer.handle('ping', () => 'pong');
    input.write('not json\n');
    input.write('{"id":1,"method":"ping"}\n');
    send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(await next()).toEqual({ jsonrpc: '2.0', id: 2, result: 'pong' });
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('handles messages split across chunks and several per chunk', async () => {
    const { input, peer, next } = setup();
    peer.handle('ping', () => 'pong');
    input.write('{"jsonrpc":"2.0",');
    input.write('"id":1,"method":"ping"}\r\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
    expect(await next()).toMatchObject({ id: 1, result: 'pong' });
    expect(await next()).toMatchObject({ id: 2, result: 'pong' });
  });

  it('runs handlers for notifications without answering', async () => {
    const { peer, next, send } = setup();
    const handler = vi.fn();
    peer.handle('event', handler);
    peer.handle('ping', () => 'pong');
    send({ jsonrpc: '2.0', method: 'event', params: [1] });
    send({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(await next()).toMatchObject({ id: 1 });
    expect(handler).toHaveBeenCalledWith([1]);
  });

  it('sends notifications without an id', async () => {
    const { peer, next } = setup();
    await peer.notify('ready', { port: 6859 });
    expect(await next()).toEqual({ jsonrpc: '2.0', method: 'ready', params: { port: 6859 } });
  });

  it('resolves request() with the matching response', async () => {
    const { peer, next, send } = setup();
    const result = peer.request('secrets.get', { key: 'k' });
    const request = (await next()) as { id: number; method: string; params: unknown };
    expect(request).toMatchObject({ jsonrpc: '2.0', method: 'secrets.get', params: { key: 'k' } });
    send({ jsonrpc: '2.0', id: request.id, result: 'value' });
    expect(await result).toBe('value');
  });

  it('rejects request() with the error of an error response', async () => {
    const { peer, next, send } = setup();
    const result = peer.request('secrets.get');
    const request = (await next()) as { id: number };
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: 'locked' } });
    await expect(result).rejects.toMatchObject({ code: -32000, message: 'locked' });
  });

  it('rejects request() after the timeout', async () => {
    const { peer } = setup({ requestTimeoutMs: 20 });
    await expect(peer.request('slow')).rejects.toThrow(/timed out/);
  });

  it('drain resolves after pending writes are flushed', async () => {
    const input = new PassThrough();
    const written: string[] = [];
    const slow = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        setTimeout(() => {
          written.push(chunk.toString());
          callback();
        }, 20);
      },
    });
    const peer = new RpcPeer(input, slow, { logger: { warn: vi.fn(), error: vi.fn() } });
    void peer.notify('one');
    void peer.notify('two');
    await peer.drain();
    expect(written).toHaveLength(2);
  });

  it('resolves closed when the input ends', async () => {
    const { input, peer } = setup();
    input.end();
    await expect(peer.closed).resolves.toBeUndefined();
  });

  it('resolves closed and stops writing when the output errors', async () => {
    const { output, peer } = setup();
    output.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await peer.closed;
    await expect(peer.notify('late')).resolves.toBeUndefined();
    await expect(peer.request('late')).rejects.toThrow(/closed/);
  });
});
