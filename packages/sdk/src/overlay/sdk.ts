import {
  OVERLAY_CLOSE_NOT_FOUND,
  type OverlayClientMessage,
  OverlayServerMessageSchema,
  reconnectDelay,
} from '@overly/shared';

export interface OverlayWidget {
  readonly id: string;
  readonly name: string;
  /** `<pluginId>:<type>` */
  readonly type: string;
}

export type Settings = Record<string, unknown>;

/** The `overly` global of overlay pages. */
export interface OverlaySdk {
  /** From the page URL, `/o/<widgetId>`. */
  readonly widgetId: string;
  /** True in the dashboard preview (`?preview=1`). */
  readonly isPreview: boolean;
  /** True in the preview unless unmuted (`&muted=0`). Media elements are muted for you. */
  readonly muted: boolean;
  /** The widget's settings, once they arrived. In the preview, unsaved edits from the form. */
  readonly settings: Settings | undefined;
  /** Runs `fn` with the settings now (if they arrived) and whenever they change. */
  onSettings(fn: (settings: Settings, widget: OverlayWidget) => void): () => void;
  /**
   * Handles an action. The action is done when `fn` returns or its promise resolves (the value
   * is the result), and failed when it throws or rejects. Register handlers while the page loads.
   */
  onAction(
    name: string,
    fn: (params: Record<string, unknown>, info: { id: string }) => unknown,
  ): () => void;
  /** Listens to custom messages from the widget's backend (`ctx.emitToOverlay`). */
  on(name: string, fn: (payload: unknown) => void): () => void;
  /** The URL of an asset chosen in the settings, or "" for none. */
  assetUrl(id: string): string;
}

/** The part of a WebSocket the SDK uses, so tests can pass a fake. */
export interface OverlaySocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface OverlayEnv {
  window: Window & typeof globalThis;
  createSocket: (url: string) => OverlaySocketLike;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

const WIDGET_PATH = /^\/o\/([a-z0-9]{12})\/?$/;
const MAX_ERROR_LENGTH = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A draft from the dashboard preview: `{ source: 'overly-dashboard', type: 'draft-settings' }`. */
function draftSettings(data: unknown): { settings: Settings | null } | undefined {
  if (!isRecord(data) || data['source'] !== 'overly-dashboard') return undefined;
  if (data['type'] !== 'draft-settings') return undefined;
  const settings = data['settings'];
  if (settings === null) return { settings: null };
  return isRecord(settings) ? { settings } : undefined;
}

/**
 * The overlay side of the SDK (ADR 0014): connects the page to its widget, delivers settings,
 * actions and messages, and answers actions. `env` makes it testable without a browser.
 */
export function createOverlaySdk(env: OverlayEnv): OverlaySdk {
  const { window } = env;
  const widgetId = WIDGET_PATH.exec(window.location.pathname)?.[1] ?? '';
  const query = new URLSearchParams(window.location.search);
  const isPreview = query.get('preview') === '1';
  const muted = isPreview && query.get('muted') !== '0';

  const settingsHandlers = new Set<(settings: Settings, widget: OverlayWidget) => void>();
  const actionHandlers = new Map<
    string,
    (params: Record<string, unknown>, info: { id: string }) => unknown
  >();
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  let widget: OverlayWidget = { id: widgetId, name: '', type: '' };
  let serverSettings: Settings | undefined;
  let draft: Settings | null = null;
  let socket: OverlaySocketLike | undefined;
  let attempt = 0;
  let stopped = false;

  const current = (): Settings | undefined => draft ?? serverSettings;

  const setVisible = (visible: boolean): void => {
    window.document.documentElement.style.visibility = visible ? '' : 'hidden';
  };

  const emitSettings = (): void => {
    const settings = current();
    if (settings === undefined) return;
    for (const handler of settingsHandlers) {
      try {
        handler(settings, widget);
      } catch (error) {
        console.error('[overly] onSettings handler failed', error);
      }
    }
  };

  const send = (message: OverlayClientMessage): void => {
    socket?.send(JSON.stringify(message));
  };

  const runAction = (id: string, name: string, params: unknown): void => {
    const handler = actionHandlers.get(name);
    if (handler === undefined) {
      send({ type: 'actionFailed', id, error: `no handler for "${name}"` });
      return;
    }
    const input = isRecord(params) ? params : {};
    Promise.resolve()
      .then(() => handler(input, { id }))
      .then(
        (result: unknown) => {
          send({ type: 'actionDone', id, ...(result === undefined ? {} : { result }) });
        },
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          send({ type: 'actionFailed', id, error: message.slice(0, MAX_ERROR_LENGTH) });
        },
      );
  };

  const onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== 'string') return;
    let json: unknown;
    try {
      json = JSON.parse(event.data);
    } catch {
      return;
    }
    const parsed = OverlayServerMessageSchema.safeParse(json);
    if (!parsed.success) return;
    const message = parsed.data;
    switch (message.type) {
      case 'init':
        widget = message.widget;
        serverSettings = message.settings;
        setVisible(message.active);
        emitSettings();
        return;
      case 'settings':
        serverSettings = message.settings;
        emitSettings();
        return;
      case 'widget':
        widget = { ...widget, name: message.name };
        setVisible(message.active);
        return;
      case 'action':
        runAction(message.id, message.name, message.params);
        return;
      case 'message':
        for (const listener of listeners.get(message.name) ?? []) {
          try {
            listener(message.payload);
          } catch (error) {
            console.error(`[overly] listener for "${message.name}" failed`, error);
          }
        }
        return;
    }
  };

  const connect = (): void => {
    if (stopped || widgetId === '') return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${protocol}://${window.location.host}/o/${widgetId}/ws${isPreview ? '?preview=1' : ''}`;
    const next = env.createSocket(url);
    socket = next;
    next.onopen = () => {
      attempt = 0;
    };
    next.onmessage = onMessage;
    next.onclose = (event) => {
      if (socket === next) socket = undefined;
      if (event.code === OVERLAY_CLOSE_NOT_FOUND) {
        // The widget was deleted: show nothing and stop trying.
        stopped = true;
        setVisible(false);
        return;
      }
      env.setTimeout(connect, reconnectDelay(attempt));
      attempt += 1;
    };
  };

  if (muted) {
    const proto = window.HTMLMediaElement.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the element below
    const play = proto.play;
    proto.play = function playMuted(this: HTMLMediaElement) {
      this.muted = true;
      return play.call(this);
    };
  }

  if (isPreview) {
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent) return;
      const message = draftSettings(event.data);
      if (message === undefined) return;
      draft = message.settings;
      emitSettings();
    });
  }

  if (window.document.readyState === 'loading') {
    window.document.addEventListener('DOMContentLoaded', connect, { once: true });
  } else {
    connect();
  }

  return {
    widgetId,
    isPreview,
    muted,
    get settings() {
      return current();
    },
    onSettings(fn) {
      settingsHandlers.add(fn);
      const settings = current();
      if (settings !== undefined) fn(settings, widget);
      return () => {
        settingsHandlers.delete(fn);
      };
    },
    onAction(name, fn) {
      actionHandlers.set(name, fn);
      return () => {
        if (actionHandlers.get(name) === fn) actionHandlers.delete(name);
      };
    },
    on(name, fn) {
      let set = listeners.get(name);
      if (set === undefined) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn);
      return () => {
        set.delete(fn);
      };
    },
    assetUrl(id) {
      return id === '' ? '' : `/assets/${encodeURIComponent(id)}`;
    },
  };
}
