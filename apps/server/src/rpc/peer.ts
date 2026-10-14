import type { Readable, Writable } from 'node:stream';

import { JSON_RPC_ERRORS, type JsonRpcMessage, JsonRpcMessageSchema } from '@overly/shared';

/** Thrown by a handler to answer with a specific JSON-RPC error code. */
export class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface RpcLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export type RpcHandler = (params: unknown) => unknown;

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

type Id = number | string;

/**
 * JSON-RPC 2.0 over a pair of streams, one JSON message per line. Used on the sidecar's stdio:
 * the shell writes to stdin and reads stdout. See docs/sidecar-protocol.md.
 */
export class RpcPeer {
  /** Resolves when the input ends or the output fails (for example EPIPE when the shell died). */
  readonly closed: Promise<void>;

  readonly #output: Writable;
  readonly #logger: RpcLogger;
  readonly #requestTimeoutMs: number;
  readonly #handlers = new Map<string, RpcHandler>();
  readonly #pending = new Map<Id, PendingRequest>();
  readonly #writes = new Set<Promise<void>>();
  #nextId = 1;
  #buffer = '';
  #isClosed = false;
  #markClosed: () => void = () => undefined;

  constructor(
    input: Readable,
    output: Writable,
    options: { logger: RpcLogger; requestTimeoutMs?: number },
  ) {
    this.#output = output;
    this.#logger = options.logger;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.closed = new Promise((resolve) => {
      this.#markClosed = resolve;
    });

    input.setEncoding('utf8');
    input.on('data', (chunk: string) => {
      this.#onData(chunk);
    });
    input.on('end', () => {
      this.#close();
    });
    input.on('close', () => {
      this.#close();
    });
    input.on('error', (error) => {
      this.#logger.warn({ err: error }, 'RPC input failed');
      this.#close();
    });
    output.on('error', (error) => {
      this.#logger.warn({ err: error }, 'RPC output failed');
      this.#close();
    });
  }

  handle(method: string, handler: RpcHandler): void {
    this.#handlers.set(method, handler);
  }

  notify(method: string, params?: unknown): Promise<void> {
    return this.#write(
      params === undefined ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', method, params },
    );
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.#isClosed) return Promise.reject(new Error('RPC channel closed'));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`RPC request ${method} timed out`));
      }, this.#requestTimeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      void this.#write(
        params === undefined
          ? { jsonrpc: '2.0', id, method }
          : { jsonrpc: '2.0', id, method, params },
      );
    });
  }

  /** Resolves once every message written so far has been handed to the output. */
  async drain(): Promise<void> {
    while (this.#writes.size > 0) await Promise.all(this.#writes);
  }

  #write(message: JsonRpcMessage): Promise<void> {
    if (this.#isClosed) return Promise.resolve();
    const write = new Promise<void>((resolve) => {
      // Errors also reach the output's 'error' listener, which closes the peer.
      this.#output.write(`${JSON.stringify(message)}\n`, () => {
        resolve();
      });
    });
    this.#writes.add(write);
    void write.then(() => this.#writes.delete(write));
    return write;
  }

  #onData(chunk: string): void {
    this.#buffer += chunk;
    let newline = this.#buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line !== '') this.#onLine(line);
      newline = this.#buffer.indexOf('\n');
    }
  }

  #onLine(line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      this.#logger.warn({ line: line.slice(0, 200) }, 'Skipped a malformed RPC line');
      return;
    }
    const parsed = JsonRpcMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.#logger.warn({ line: line.slice(0, 200) }, 'Skipped an invalid RPC message');
      return;
    }
    const message = parsed.data;
    if ('method' in message) {
      void this.#onCall(message.method, message.params, 'id' in message ? message.id : undefined);
    } else if ('error' in message) {
      if (message.id !== null) {
        this.#settle(message.id)?.reject(new RpcError(message.error.code, message.error.message));
      }
    } else {
      this.#settle(message.id)?.resolve(message.result);
    }
  }

  #settle(id: Id): PendingRequest | undefined {
    const pending = this.#pending.get(id);
    if (pending === undefined) return undefined;
    this.#pending.delete(id);
    clearTimeout(pending.timer);
    return pending;
  }

  async #onCall(method: string, params: unknown, id: Id | undefined): Promise<void> {
    const handler = this.#handlers.get(method);
    if (handler === undefined) {
      if (id !== undefined) {
        await this.#write({
          jsonrpc: '2.0',
          id,
          error: { code: JSON_RPC_ERRORS.methodNotFound, message: `Method not found: ${method}` },
        });
      }
      return;
    }
    try {
      const result: unknown = await handler(params);
      if (id !== undefined) await this.#write({ jsonrpc: '2.0', id, result: result ?? null });
    } catch (error) {
      if (id === undefined) {
        this.#logger.error({ err: error, method }, 'RPC notification handler failed');
        return;
      }
      const code = error instanceof RpcError ? error.code : JSON_RPC_ERRORS.internalError;
      const message = error instanceof Error ? error.message : String(error);
      await this.#write({ jsonrpc: '2.0', id, error: { code, message } });
    }
  }

  #close(): void {
    if (this.#isClosed) return;
    this.#isClosed = true;
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('RPC channel closed'));
      this.#pending.delete(id);
    }
    this.#markClosed();
  }
}
