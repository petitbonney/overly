import {
  type BackendToHostMessage,
  type ChannelEnd,
  type HostToBackendMessage,
  HostToBackendMessageSchema,
  type JsonValue,
} from '@overly/shared';

import type {
  AnyWidgetBackend,
  BackendLogger,
  OverlayActionOutcome,
  OverlayHandle,
  PluginBackendDefinition,
  WidgetContext,
} from './define.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface Instance {
  backend: AnyWidgetBackend;
  widget: { id: string; name: string; type: string };
  settings: Record<string, unknown>;
  state: unknown;
}

interface PendingRequest {
  resolve(outcome: OverlayActionOutcome): void;
  reject(error: Error): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The plugin side of the backend protocol (ADR 0015). Overly runs it in-process for built-in
 * plugins, and in a child process for third-party plugins (Phase 8), behind the same messages.
 */
export function runPluginBackend(
  definition: PluginBackendDefinition,
  channel: ChannelEnd,
): { close(): void } {
  const instances = new Map<string, Instance>();
  const requests = new Map<string, PendingRequest>();
  let nextRequest = 0;

  const send = (message: BackendToHostMessage): void => {
    channel.send(message);
  };
  const log = (level: Level, msg: string, widgetId?: string, data?: Record<string, unknown>) => {
    send({
      type: 'log',
      level,
      msg,
      ...(widgetId === undefined ? {} : { widgetId }),
      ...(data === undefined ? {} : { data }),
    });
  };

  const logger = (widgetId: string): BackendLogger => ({
    debug: (msg, data) => {
      log('debug', msg, widgetId, data);
    },
    info: (msg, data) => {
      log('info', msg, widgetId, data);
    },
    warn: (msg, data) => {
      log('warn', msg, widgetId, data);
    },
    error: (msg, data) => {
      log('error', msg, widgetId, data);
    },
  });

  /** A context for `instance`. `callId` is set while handling an action. */
  const context = (instance: Instance, callId?: string): WidgetContext => {
    const widgetId = instance.widget.id;
    return {
      widget: instance.widget,
      get settings() {
        return instance.settings;
      },
      get state() {
        return instance.state;
      },
      setState(next) {
        instance.state = next;
        // The channel serializes the state, and the host validates it as JSON.
        send({ type: 'setState', widgetId, state: next as JsonValue });
      },
      emitToOverlay(name, payload) {
        send({ type: 'emitToOverlay', widgetId, name, payload });
      },
      runOverlayAction(name, params, options) {
        nextRequest += 1;
        const requestId = `r${String(nextRequest)}`;
        return new Promise<OverlayActionOutcome>((resolve, reject) => {
          requests.set(requestId, { resolve, reject });
          send({
            type: 'overlayAction',
            widgetId,
            requestId,
            ...(callId === undefined ? {} : { callId }),
            name,
            params,
            ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          });
        });
      },
      emitEvent(name, payload) {
        send({ type: 'emitEvent', widgetId, name, payload });
      },
      log: logger(widgetId),
      platform: {},
    };
  };

  const guarded = async (
    widgetId: string,
    hook: string,
    run: () => void | Promise<void>,
  ): Promise<void> => {
    try {
      await run();
    } catch (error) {
      log('error', `${hook} failed: ${errorMessage(error)}`, widgetId);
    }
  };

  const handle = async (message: HostToBackendMessage): Promise<void> => {
    switch (message.type) {
      case 'start': {
        const backend = definition.widgets[message.widgetType];
        if (backend === undefined) {
          log('error', `Unknown widget type "${message.widgetType}"`, message.widgetId);
          return;
        }
        const instance: Instance = {
          backend,
          widget: { ...message.widget, type: message.widgetType },
          settings: message.settings,
          state: message.state ?? backend.initialState ?? null,
        };
        instances.set(message.widgetId, instance);
        await guarded(message.widgetId, 'onStart', () => backend.onStart?.(context(instance)));
        return;
      }
      case 'settings': {
        const instance = instances.get(message.widgetId);
        if (instance === undefined) return;
        const previous = instance.settings;
        instance.settings = message.settings;
        await guarded(message.widgetId, 'onSettings', () =>
          instance.backend.onSettings?.(context(instance), previous),
        );
        return;
      }
      case 'action': {
        const { widgetId, callId } = message;
        const fail = (error: string): void => {
          send({ type: 'actionResult', widgetId, callId, ok: false, error });
        };
        const instance = instances.get(widgetId);
        if (instance === undefined) {
          fail(`widget ${widgetId} is not started`);
          return;
        }
        const handler = instance.backend.actions?.[message.name];
        if (handler === undefined) {
          fail(`no handler for "${message.name}"`);
          return;
        }
        const params =
          typeof message.params === 'object' && message.params !== null
            ? (message.params as Record<string, unknown>)
            : {};
        try {
          const result: unknown = await handler(params, context(instance, callId), {
            actionId: message.actionId,
          });
          send({
            type: 'actionResult',
            widgetId,
            callId,
            ok: true,
            ...(result === undefined ? {} : { result }),
          });
        } catch (error) {
          fail(errorMessage(error));
        }
        return;
      }
      case 'overlayConnected': {
        const instance = instances.get(message.widgetId);
        if (instance === undefined) return;
        const { widgetId, overlayId } = message;
        const overlay: OverlayHandle = {
          id: overlayId,
          preview: message.preview,
          emit(name, payload) {
            send({ type: 'emitToOverlay', widgetId, name, payload, overlayId });
          },
        };
        await guarded(widgetId, 'onOverlayConnect', () =>
          instance.backend.onOverlayConnect?.(context(instance), overlay),
        );
        return;
      }
      case 'overlayActionResult': {
        const request = requests.get(message.requestId);
        if (request === undefined) return;
        requests.delete(message.requestId);
        if (!message.ok) {
          request.reject(new Error(message.error ?? 'The overlay action failed'));
        } else if (message.delivered === true) {
          request.resolve({ delivered: true, result: message.result });
        } else {
          request.resolve({ delivered: false });
        }
        return;
      }
      case 'migrate': {
        const backend = definition.widgets[message.widgetType];
        try {
          const settings =
            backend?.migrateSettings === undefined
              ? message.settings
              : await backend.migrateSettings(message.settings, {
                  from: message.from,
                  to: message.to,
                });
          send({ type: 'migrateResult', requestId: message.requestId, ok: true, settings });
        } catch (error) {
          send({
            type: 'migrateResult',
            requestId: message.requestId,
            ok: false,
            error: errorMessage(error),
          });
        }
        return;
      }
      case 'stop': {
        const instance = instances.get(message.widgetId);
        if (instance === undefined) return;
        instances.delete(message.widgetId);
        await guarded(message.widgetId, 'onStop', () =>
          instance.backend.onStop?.(context(instance)),
        );
        return;
      }
    }
  };

  channel.onMessage((raw) => {
    const parsed = HostToBackendMessageSchema.safeParse(raw);
    if (!parsed.success) {
      log('warn', 'Ignored an invalid message from the host');
      return;
    }
    void handle(parsed.data);
  });

  send({
    type: 'ready',
    widgets: Object.fromEntries(
      Object.entries(definition.widgets).map(([type, backend]) => [
        type,
        {
          actions: Object.keys(backend.actions ?? {}),
          migrates: backend.migrateSettings !== undefined,
        },
      ]),
    ),
  });

  return {
    close() {
      for (const request of requests.values()) request.reject(new Error('The backend stopped'));
      requests.clear();
      instances.clear();
      channel.close();
    },
  };
}
