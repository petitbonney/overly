import { OVERLAY_CLOSE_NOT_FOUND } from '@overly/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

import type { OverlayHub } from '../widgets/overlay-hub.js';
import type { WidgetService } from '../widgets/service.js';
import { WS_PING_INTERVAL_MS } from './hub.js';

/**
 * `/o/<widgetId>/ws`, the overlay channel (ADR 0014). No session: the guard checks Host and an
 * allowed Origin, which here includes `null`, the origin of sandboxed overlay pages. Overlays
 * that stop answering pings are dropped, so connection counts stay true.
 */
export function registerOverlaySocket(
  app: FastifyInstance,
  options: { widgets: WidgetService; overlays: OverlayHub; pingIntervalMs?: number },
): void {
  const { widgets, overlays } = options;
  const alive = new Map<WebSocket, boolean>();

  app.get<{ Params: { widgetId: string }; Querystring: { preview?: string } }>(
    '/o/:widgetId/ws',
    { websocket: true },
    (socket, request) => {
      const { widgetId } = request.params;
      if (!widgets.has(widgetId) || widgets.typeOf(widgetId) === undefined) {
        socket.close(OVERLAY_CLOSE_NOT_FOUND, 'widget not found');
        return;
      }
      const connection = overlays.attach(widgetId, socket, request.query.preview === '1');
      alive.set(socket, true);
      socket.on('pong', () => alive.set(socket, true));
      socket.on('message', (data: Buffer) => {
        overlays.handleMessage(connection.id, data.toString());
      });
      socket.on('close', () => {
        alive.delete(socket);
        overlays.detach(connection.id);
      });
      widgets.overlayAttached(connection);
    },
  );

  const timer = setInterval(() => {
    for (const [socket, answered] of alive) {
      if (!answered) {
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
}
