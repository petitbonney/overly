import { OverlayClientMessageSchema, type OverlayServerMessage } from '@overly/shared';
import type pino from 'pino';

import { randomId } from '../util/random-id.js';

/** The part of a WebSocket the hub uses, so tests can pass a fake. */
export interface OverlaySocket {
  send(data: string): void;
  close(code: number, reason: string): void;
}

export interface OverlayConnection {
  readonly id: string;
  readonly widgetId: string;
  /** Opened by the dashboard preview (`?preview=1`) rather than OBS. */
  readonly preview: boolean;
}

export type OverlayOutcome = { delivered: true; result: unknown } | { delivered: false };

/** An overlay action that failed: `timeout`, or the error an overlay reported. */
export class OverlayActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverlayActionError';
  }
}

export interface OverlayCounts {
  live: number;
  preview: number;
}

interface Connection extends OverlayConnection {
  socket: OverlaySocket;
}

interface Delivery {
  targets: Set<string>;
  failures: string[];
  timer: NodeJS.Timeout;
  resolve(outcome: OverlayOutcome): void;
  reject(error: OverlayActionError): void;
}

/**
 * The overlay sockets of every widget (OBS and dashboard previews). Actions go to every overlay
 * connected at that moment; the first one to finish wins.
 */
export class OverlayHub {
  readonly #logger: pino.Logger;
  readonly #onCountsChange: ((widgetId: string, counts: OverlayCounts) => void) | undefined;
  readonly #connections = new Map<string, Connection>();
  readonly #deliveries = new Map<string, Delivery>();

  constructor(options: {
    logger: pino.Logger;
    onCountsChange?: (widgetId: string, counts: OverlayCounts) => void;
  }) {
    this.#logger = options.logger;
    this.#onCountsChange = options.onCountsChange;
  }

  attach(widgetId: string, socket: OverlaySocket, preview: boolean): OverlayConnection {
    const connection: Connection = { id: randomId(), widgetId, preview, socket };
    this.#connections.set(connection.id, connection);
    this.#countsChanged(widgetId);
    return { id: connection.id, widgetId, preview };
  }

  detach(connectionId: string): void {
    const connection = this.#connections.get(connectionId);
    if (connection === undefined) return;
    this.#connections.delete(connectionId);
    for (const [id, delivery] of this.#deliveries) {
      if (delivery.targets.delete(connectionId)) this.#settleIfDone(id, delivery);
    }
    this.#countsChanged(connection.widgetId);
  }

  handleMessage(connectionId: string, raw: string): void {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.#logger.debug({ connectionId }, 'Ignored an overlay message that is not JSON');
      return;
    }
    const parsed = OverlayClientMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.#logger.debug({ connectionId }, 'Ignored an invalid overlay message');
      return;
    }
    const message = parsed.data;
    const delivery = this.#deliveries.get(message.id);
    // Late answers (after the action settled) and answers from overlays it wasn't sent to.
    if (delivery?.targets.has(connectionId) !== true) return;
    if (message.type === 'actionDone') {
      this.#finish(message.id, delivery);
      delivery.resolve({ delivered: true, result: message.result });
      return;
    }
    delivery.targets.delete(connectionId);
    delivery.failures.push(message.error);
    this.#settleIfDone(message.id, delivery);
  }

  /** Sends to every overlay of the widget, or to one connection. */
  send(widgetId: string, message: OverlayServerMessage, connectionId?: string): void {
    const data = JSON.stringify(message);
    for (const connection of this.#widgetConnections(widgetId)) {
      if (connectionId !== undefined && connection.id !== connectionId) continue;
      this.#write(connection, data);
    }
  }

  /**
   * Sends an action to every overlay connected now. Resolves with the first `actionDone`;
   * undelivered when nothing is connected or every overlay disconnects first. Rejects when every
   * overlay failed or disconnected (and at least one failed), or after `timeoutMs`.
   */
  runAction(
    widgetId: string,
    name: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<OverlayOutcome> {
    const targets = this.#widgetConnections(widgetId);
    if (targets.length === 0) return Promise.resolve({ delivered: false });
    const id = randomId();
    return new Promise<OverlayOutcome>((resolve, reject) => {
      const delivery: Delivery = {
        targets: new Set(targets.map((connection) => connection.id)),
        failures: [],
        timer: setTimeout(() => {
          this.#finish(id, delivery);
          reject(new OverlayActionError('timeout'));
        }, timeoutMs),
        resolve,
        reject,
      };
      this.#deliveries.set(id, delivery);
      const data = JSON.stringify({ type: 'action', id, name, params });
      for (const connection of targets) this.#write(connection, data);
    });
  }

  counts(widgetId: string): OverlayCounts {
    const counts = { live: 0, preview: 0 };
    for (const connection of this.#widgetConnections(widgetId)) {
      if (connection.preview) counts.preview += 1;
      else counts.live += 1;
    }
    return counts;
  }

  closeWidget(widgetId: string, code: number, reason: string): void {
    for (const connection of this.#widgetConnections(widgetId)) {
      this.#close(connection, code, reason);
    }
  }

  closeAll(code: number, reason: string): void {
    for (const connection of [...this.#connections.values()]) {
      this.#close(connection, code, reason);
    }
  }

  #close(connection: Connection, code: number, reason: string): void {
    try {
      connection.socket.close(code, reason);
    } catch (error) {
      this.#logger.debug({ err: error }, 'Closing an overlay socket failed');
    }
    this.detach(connection.id);
  }

  #widgetConnections(widgetId: string): Connection[] {
    return [...this.#connections.values()].filter((connection) => connection.widgetId === widgetId);
  }

  #write(connection: Connection, data: string): void {
    try {
      connection.socket.send(data);
    } catch (error) {
      this.#logger.debug({ err: error, connectionId: connection.id }, 'Overlay send failed');
    }
  }

  #settleIfDone(id: string, delivery: Delivery): void {
    if (delivery.targets.size > 0) return;
    this.#finish(id, delivery);
    const [failure] = delivery.failures;
    if (failure === undefined) delivery.resolve({ delivered: false });
    else delivery.reject(new OverlayActionError(failure));
  }

  #finish(id: string, delivery: Delivery): void {
    clearTimeout(delivery.timer);
    this.#deliveries.delete(id);
  }

  #countsChanged(widgetId: string): void {
    this.#onCountsChange?.(widgetId, this.counts(widgetId));
  }
}
