import { type PluginBackendDefinition, runPluginBackend } from '@overly/sdk/backend';
import {
  type BackendToHostMessage,
  BackendToHostMessageSchema,
  type ChannelEnd,
  type HostToBackendMessage,
  type JsonValue,
  MAX_STATE_BYTES,
  type PluginManifest,
} from '@overly/shared';
import type pino from 'pino';

import type { PluginRegistry } from '../plugins/registry.js';
import { createInProcessChannel } from './in-process-channel.js';
import type { OverlayOutcome } from './overlay-hub.js';

/** What the server does with the messages a plugin backend sends. */
export interface BackendDelegate {
  setState(widgetId: string, state: JsonValue): void;
  emitToOverlay(widgetId: string, name: string, payload: unknown, overlayId?: string): void;
  overlayAction(
    widgetId: string,
    request: {
      name: string;
      params: unknown;
      timeoutMs: number | undefined;
      /** Set when the backend sent it while handling this action. */
      actionId: string | undefined;
    },
  ): Promise<OverlayOutcome>;
  emitEvent(widgetId: string, name: string, payload: unknown): void;
}

/** Starts the backend side of a channel. Tests replace it to send raw messages. */
export type BackendRunner = (channel: ChannelEnd) => { close(): void };

export const BACKEND_READY_TIMEOUT_MS = 5_000;
export const BACKEND_STOP_GRACE_MS = 1_000;
const MIGRATE_TIMEOUT_MS = 5_000;

export class BackendStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendStartError';
  }
}

interface Pending<T> {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface Call extends Pending<unknown> {
  actionId: string;
  deadline: number;
}

export interface StartWidget {
  widgetId: string;
  widgetType: string;
  widget: { id: string; name: string };
  settings: Record<string, unknown>;
  state: JsonValue;
}

function withTimeout<T>(ms: number, register: (pending: Pending<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, ms);
    register({
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      timer,
    });
  });
}

/** Problems with what a backend says it handles, compared with its manifest. */
function readyProblems(
  manifest: PluginManifest,
  handled: ReadonlyMap<string, { actions: ReadonlySet<string> }>,
): string[] {
  const problems: string[] = [];
  for (const [type, { actions }] of handled) {
    const decl = manifest.widgets.find((widget) => widget.type === type);
    if (decl === undefined) {
      problems.push(
        `backend declares the widget type "${type}", which the manifest does not declare`,
      );
      continue;
    }
    for (const action of actions) {
      if (!decl.actions.some((declared) => declared.name === action)) {
        problems.push(`backend handles "${type}:${action}", which the manifest does not declare`);
      }
    }
  }
  return problems;
}

/** Actions that nothing would handle: no overlay, and the backend (if any) doesn't handle them. */
function unhandledActions(
  manifest: PluginManifest,
  handled: ReadonlyMap<string, { actions: ReadonlySet<string> }>,
): string[] {
  const problems: string[] = [];
  for (const widget of manifest.widgets) {
    if (widget.overlay !== undefined) continue;
    for (const action of widget.actions) {
      if (handled.get(widget.type)?.actions.has(action.name) !== true) {
        problems.push(
          `action "${widget.type}:${action.name}" has no handler: add an overlay or handle it in the backend`,
        );
      }
    }
  }
  return problems;
}

/** The host side of one plugin's backend: every widget of that plugin goes through it. */
export class PluginBackendConnection {
  readonly pluginId: string;
  readonly #channel: ChannelEnd;
  readonly #delegate: BackendDelegate;
  readonly #logger: pino.Logger;
  readonly #handled = new Map<string, { actions: Set<string>; migrates: boolean }>();
  readonly #calls = new Map<string, Call>();
  readonly #migrations = new Map<string, Pending<Record<string, unknown>>>();
  readonly #started = new Set<string>();
  #runtime: { close(): void } | undefined;
  #onReady: (() => void) | undefined;
  #nextId = 0;

  private constructor(
    pluginId: string,
    channel: ChannelEnd,
    delegate: BackendDelegate,
    logger: pino.Logger,
  ) {
    this.pluginId = pluginId;
    this.#channel = channel;
    this.#delegate = delegate;
    this.#logger = logger;
    channel.onMessage((raw) => {
      this.#receive(raw);
    });
  }

  /** Starts the backend and checks what it handles against the manifest. */
  static async start(options: {
    manifest: PluginManifest;
    definition: PluginBackendDefinition;
    delegate: BackendDelegate;
    logger: pino.Logger;
    run?: BackendRunner;
    readyTimeoutMs?: number;
  }): Promise<PluginBackendConnection> {
    const { manifest } = options;
    const [hostEnd, backendEnd] = createInProcessChannel();
    const connection = new PluginBackendConnection(
      manifest.id,
      hostEnd,
      options.delegate,
      options.logger,
    );
    const timeoutMs = options.readyTimeoutMs ?? BACKEND_READY_TIMEOUT_MS;
    const ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        resolve(false);
      }, timeoutMs);
      connection.#onReady = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
    const run: BackendRunner =
      options.run ?? ((channel) => runPluginBackend(options.definition, channel));
    connection.#runtime = run(backendEnd);

    if (!(await ready)) {
      await connection.close();
      throw new BackendStartError(`backend did not start within ${String(timeoutMs / 1000)} s`);
    }
    const problems = [
      ...readyProblems(manifest, connection.#handled),
      ...unhandledActions(manifest, connection.#handled),
    ];
    if (problems.length > 0) {
      await connection.close();
      throw new BackendStartError(problems.join('; '));
    }
    return connection;
  }

  handles(widgetType: string, action: string): boolean {
    return this.#handled.get(widgetType)?.actions.has(action) === true;
  }

  migrates(widgetType: string): boolean {
    return this.#handled.get(widgetType)?.migrates === true;
  }

  startWidget(start: StartWidget): void {
    this.#started.add(start.widgetId);
    this.#send({ type: 'start', ...start });
  }

  updateSettings(widgetId: string, settings: Record<string, unknown>): void {
    if (this.#started.has(widgetId)) this.#send({ type: 'settings', widgetId, settings });
  }

  overlayConnected(widgetId: string, overlayId: string, preview: boolean): void {
    if (this.#started.has(widgetId)) {
      this.#send({ type: 'overlayConnected', widgetId, overlayId, preview });
    }
  }

  stopWidget(widgetId: string): void {
    if (this.#started.delete(widgetId)) this.#send({ type: 'stop', widgetId });
  }

  isStarted(widgetId: string): boolean {
    return this.#started.has(widgetId);
  }

  /** Runs an action in the backend. Rejects with the backend's error, or with `timeout`. */
  runAction(
    widgetId: string,
    call: { actionId: string; name: string; params: unknown; timeoutMs: number },
  ): Promise<unknown> {
    const callId = this.#id('c');
    return withTimeout<unknown>(call.timeoutMs, (pending) => {
      this.#calls.set(callId, {
        ...pending,
        resolve: (value) => {
          this.#calls.delete(callId);
          pending.resolve(value);
        },
        reject: (error) => {
          this.#calls.delete(callId);
          pending.reject(error);
        },
        actionId: call.actionId,
        deadline: Date.now() + call.timeoutMs,
      });
      this.#send({
        type: 'action',
        widgetId,
        callId,
        actionId: call.actionId,
        name: call.name,
        params: call.params,
      });
    }).finally(() => this.#calls.delete(callId));
  }

  migrate(
    widgetType: string,
    settings: Record<string, unknown>,
    from: string,
    to: string,
  ): Promise<Record<string, unknown>> {
    const requestId = this.#id('m');
    return withTimeout<Record<string, unknown>>(MIGRATE_TIMEOUT_MS, (pending) => {
      this.#migrations.set(requestId, pending);
      this.#send({ type: 'migrate', requestId, widgetType, settings, from, to });
    }).finally(() => this.#migrations.delete(requestId));
  }

  /**
   * Stops every widget, gives running actions up to `graceMs` to finish, then fails the rest and
   * closes the channel.
   */
  async close(graceMs = BACKEND_STOP_GRACE_MS): Promise<void> {
    for (const widgetId of [...this.#started]) this.stopWidget(widgetId);
    const running = [...this.#calls.values()].map(
      (call) =>
        new Promise<void>((resolve) => {
          const { resolve: done, reject: failed } = call;
          call.resolve = (value) => {
            done(value);
            resolve();
          };
          call.reject = (error) => {
            failed(error);
            resolve();
          };
        }),
    );
    if (running.length > 0) {
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.all(running),
        new Promise((resolve) => {
          timer = setTimeout(resolve, graceMs);
        }),
      ]);
      clearTimeout(timer);
    }
    for (const call of [...this.#calls.values()]) call.reject(new Error('The backend stopped'));
    for (const migration of this.#migrations.values()) {
      migration.reject(new Error('The backend stopped'));
    }
    this.#runtime?.close();
    this.#channel.close();
  }

  #id(prefix: string): string {
    this.#nextId += 1;
    return `${prefix}${String(this.#nextId)}`;
  }

  #send(message: HostToBackendMessage): void {
    this.#channel.send(message);
  }

  #receive(raw: unknown): void {
    const parsed = BackendToHostMessageSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.warn({ pluginId: this.pluginId }, 'Ignored an invalid message from a backend');
      return;
    }
    const message = parsed.data;
    if ('widgetId' in message && message.widgetId !== undefined && message.type !== 'log') {
      if (!this.#started.has(message.widgetId)) {
        this.#logger.warn(
          { pluginId: this.pluginId, widgetId: message.widgetId, type: message.type },
          'Ignored a backend message for a widget it does not run',
        );
        return;
      }
    }
    this.#handle(message);
  }

  #handle(message: BackendToHostMessage): void {
    switch (message.type) {
      case 'ready':
        for (const [type, info] of Object.entries(message.widgets)) {
          this.#handled.set(type, { actions: new Set(info.actions), migrates: info.migrates });
        }
        this.#onReady?.();
        this.#onReady = undefined;
        return;
      case 'actionResult': {
        const call = this.#calls.get(message.callId);
        if (call === undefined) return;
        if (message.ok) call.resolve(message.result);
        else call.reject(new Error(message.error ?? 'The action failed'));
        return;
      }
      case 'setState': {
        const size = Buffer.byteLength(JSON.stringify(message.state));
        if (size > MAX_STATE_BYTES) {
          this.#logger.warn(
            { pluginId: this.pluginId, widgetId: message.widgetId, size },
            'Ignored a widget state larger than 1 MB',
          );
          return;
        }
        this.#delegate.setState(message.widgetId, message.state);
        return;
      }
      case 'emitToOverlay':
        this.#delegate.emitToOverlay(
          message.widgetId,
          message.name,
          message.payload,
          message.overlayId,
        );
        return;
      case 'overlayAction': {
        const call = message.callId === undefined ? undefined : this.#calls.get(message.callId);
        const timeoutMs =
          message.timeoutMs ??
          (call === undefined ? undefined : Math.max(1, call.deadline - Date.now()));
        const { widgetId, requestId } = message;
        this.#delegate
          .overlayAction(widgetId, {
            name: message.name,
            params: message.params,
            timeoutMs,
            actionId: call?.actionId,
          })
          .then(
            (outcome) => {
              this.#send({
                type: 'overlayActionResult',
                widgetId,
                requestId,
                ok: true,
                delivered: outcome.delivered,
                ...(outcome.delivered ? { result: outcome.result } : {}),
              });
            },
            (error: unknown) => {
              this.#send({
                type: 'overlayActionResult',
                widgetId,
                requestId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          );
        return;
      }
      case 'emitEvent':
        this.#delegate.emitEvent(message.widgetId, message.name, message.payload);
        return;
      case 'log':
        this.#logger[message.level](
          { pluginId: this.pluginId, widgetId: message.widgetId, ...message.data },
          message.msg,
        );
        return;
      case 'migrateResult': {
        const migration = this.#migrations.get(message.requestId);
        if (migration === undefined) return;
        if (message.ok && message.settings !== undefined) migration.resolve(message.settings);
        else migration.reject(new Error(message.error ?? 'The migration failed'));
        return;
      }
    }
  }
}

/**
 * Starts the backend of every ok plugin that has one (built-ins in-process, ADR 0015). A plugin
 * whose backend is missing, doesn't start, or doesn't match its manifest is marked broken.
 */
export class BackendHost {
  readonly #connections: Map<string, PluginBackendConnection>;

  private constructor(connections: Map<string, PluginBackendConnection>) {
    this.#connections = connections;
  }

  static async start(options: {
    registry: PluginRegistry;
    builtins: Readonly<Record<string, PluginBackendDefinition>>;
    delegate: BackendDelegate;
    logger: pino.Logger;
    run?: BackendRunner;
    readyTimeoutMs?: number;
  }): Promise<BackendHost> {
    const { registry, logger } = options;
    const connections = new Map<string, PluginBackendConnection>();
    for (const entry of registry.plugins()) {
      const { manifest } = entry;
      if (entry.status !== 'ok' || manifest === undefined) continue;
      const fail = (error: string): void => {
        logger.warn({ pluginId: manifest.id, error }, 'Plugin backend failed');
        registry.markBroken(manifest.id, error);
      };
      if (manifest.backend === undefined) {
        const problems = unhandledActions(manifest, new Map());
        if (problems.length > 0) fail(problems.join('; '));
        continue;
      }
      const definition = Object.hasOwn(options.builtins, manifest.id)
        ? options.builtins[manifest.id]
        : undefined;
      if (definition === undefined && options.run === undefined) {
        fail('backend not available');
        continue;
      }
      try {
        const connection = await PluginBackendConnection.start({
          manifest,
          definition: definition ?? { widgets: {} },
          delegate: options.delegate,
          logger,
          ...(options.run === undefined ? {} : { run: options.run }),
          ...(options.readyTimeoutMs === undefined
            ? {}
            : { readyTimeoutMs: options.readyTimeoutMs }),
        });
        connections.set(manifest.id, connection);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
    return new BackendHost(connections);
  }

  connection(pluginId: string): PluginBackendConnection | undefined {
    return this.#connections.get(pluginId);
  }

  async close(): Promise<void> {
    await Promise.all([...this.#connections.values()].map((connection) => connection.close()));
  }
}
