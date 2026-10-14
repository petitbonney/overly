import type { AddressInfo } from 'node:net';

import { OVERLY_VERSION } from '@overly/shared';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildTestApp, sessionCookie, type TestApp } from '../testing/app.js';

let running: TestApp | undefined;

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

async function listen(wsPingIntervalMs?: number): Promise<TestApp & { port: number }> {
  let port = 0;
  running = await buildTestApp({
    getPort: () => port,
    ...(wsPingIntervalMs === undefined ? {} : { wsPingIntervalMs }),
  });
  await running.app.listen({ host: '127.0.0.1', port: 0 });
  port = (running.app.server.address() as AddressInfo).port;
  return { ...running, port };
}

function rejectionStatus(socket: WebSocket): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.on('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0);
    });
    socket.on('open', () => {
      reject(new Error('the upgrade was accepted'));
    });
  });
}

function firstMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data: Buffer) => {
      resolve(JSON.parse(data.toString()));
    });
    socket.once('error', reject);
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    socket.once('close', (code) => {
      resolve(code);
    });
  });
}

describe('/ws', () => {
  it('sends hello with the server version', async () => {
    const { app, tokens, port } = await listen();
    const cookie = await sessionCookie(app, tokens, `127.0.0.1:${String(port)}`);
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie },
      origin: `http://127.0.0.1:${String(port)}`,
    });
    expect(await firstMessage(socket)).toEqual({ type: 'hello', version: OVERLY_VERSION });
    socket.close();
  });

  it('rejects a forged Origin with 403', async () => {
    const { app, tokens, port } = await listen();
    const cookie = await sessionCookie(app, tokens, `127.0.0.1:${String(port)}`);
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie },
      origin: 'http://evil.com',
    });
    expect(await rejectionStatus(socket)).toBe(403);
  });

  it('rejects a forged Host with 403', async () => {
    const { app, tokens, port } = await listen();
    const cookie = await sessionCookie(app, tokens, `127.0.0.1:${String(port)}`);
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie, host: 'evil.com' },
      origin: `http://127.0.0.1:${String(port)}`,
    });
    expect(await rejectionStatus(socket)).toBe(403);
  });

  it('rejects a client without a session with 401', async () => {
    const { port } = await listen();
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      origin: `http://127.0.0.1:${String(port)}`,
    });
    expect(await rejectionStatus(socket)).toBe(401);
  });

  it('closes every client with 1001 on closeAll', async () => {
    const { app, tokens, port, hub } = await listen();
    const cookie = await sessionCookie(app, tokens, `127.0.0.1:${String(port)}`);
    const sockets = [1, 2].map(
      () =>
        new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
          headers: { cookie },
          origin: `http://127.0.0.1:${String(port)}`,
        }),
    );
    await Promise.all(sockets.map(firstMessage));
    expect(hub.size).toBe(2);
    const codes = Promise.all(sockets.map(closeCode));
    hub.closeAll(1001, 'server shutting down');
    expect(await codes).toEqual([1001, 1001]);
  });

  it('terminates a client that stops answering pings', async () => {
    const { app, tokens, port } = await listen(50);
    const cookie = await sessionCookie(app, tokens, `127.0.0.1:${String(port)}`);
    const socket = new WebSocket(`ws://127.0.0.1:${String(port)}/ws`, {
      headers: { cookie },
      origin: `http://127.0.0.1:${String(port)}`,
      autoPong: false,
    });
    await firstMessage(socket);
    // A terminated connection closes without a close frame: code 1006.
    expect(await closeCode(socket)).toBe(1006);
  });
});
