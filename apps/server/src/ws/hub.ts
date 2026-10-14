import fastifyWebsocket from '@fastify/websocket';
import type { ServerMessage } from '@overly/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

export interface WsHub {
  readonly size: number;
  closeAll(code: number, reason: string): void;
}

export const WS_PING_INTERVAL_MS = 30_000;

/**
 * Registers @fastify/websocket. It must come before the guard: the plugin marks upgrade requests in
 * its own onRequest hook, and only then destroys the socket of an upgrade the guard rejected.
 */
export async function registerWebSocketPlugin(app: FastifyInstance): Promise<void> {
  await app.register(fastifyWebsocket);
}

/**
 * `/ws` for the dashboard. The guard has already checked Host, Origin and the session on the
 * upgrade. Peers that miss a ping are terminated. Phase 1 ignores client messages.
 */
export function registerWebSocket(
  app: FastifyInstance,
  options: { version: string; pingIntervalMs?: number },
): WsHub {
  const clients = new Set<WebSocket>();
  const alive = new WeakMap<WebSocket, boolean>();

  app.get('/ws', { websocket: true }, (socket) => {
    clients.add(socket);
    alive.set(socket, true);
    socket.on('pong', () => alive.set(socket, true));
    socket.on('close', () => clients.delete(socket));
    const hello: ServerMessage = { type: 'hello', version: options.version };
    socket.send(JSON.stringify(hello));
  });

  const timer = setInterval(() => {
    for (const socket of clients) {
      if (alive.get(socket) !== true) {
        socket.terminate();
        continue;
      }
      alive.set(socket, false);
      socket.ping();
    }
  }, options.pingIntervalMs ?? WS_PING_INTERVAL_MS);
  timer.unref();
  app.addHook('onClose', () => {
    clearInterval(timer);
  });

  return {
    get size() {
      return clients.size;
    },
    closeAll(code, reason) {
      for (const socket of clients) socket.close(code, reason);
    },
  };
}
