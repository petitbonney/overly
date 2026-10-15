/** What `runOverlayAction` resolves with: the overlay's result, or nothing when none played it. */
export type OverlayActionOutcome = { delivered: true; result: unknown } | { delivered: false };

export interface BackendLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface WidgetInfo {
  readonly id: string;
  readonly name: string;
  /** The widget type inside the plugin, e.g. `banner`. */
  readonly type: string;
}

/** What a widget backend gets in every handler. */
export interface WidgetContext<S = Record<string, unknown>, St = unknown> {
  readonly widget: WidgetInfo;
  /** The saved settings, already validated against the manifest. */
  readonly settings: S;
  /** Persistent state: `initialState` until the backend sets one. */
  readonly state: St;
  /** Saves the state (JSON, at most 1 MB) with the widget. */
  setState(next: St): void;
  /** Sends a custom message to every overlay of the widget (`overly.on(name, …)`). */
  emitToOverlay(name: string, payload?: unknown): void;
  /** Runs an overlay action (`overly.onAction(name, …)`) and waits for an overlay to finish it. */
  runOverlayAction(
    name: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<OverlayActionOutcome>;
  /** Emits a widget event declared in the manifest, for pipelines. */
  emitEvent(name: string, payload?: unknown): void;
  readonly log: BackendLogger;
  /** Platform APIs allowed by the plugin's permissions. Empty until Twitch arrives (Phase 3). */
  readonly platform: Readonly<Record<string, never>>;
}

/** An overlay that just connected, for `onOverlayConnect`. */
export interface OverlayHandle {
  readonly id: string;
  readonly preview: boolean;
  /** Sends a custom message to this overlay only. */
  emit(name: string, payload?: unknown): void;
}

export type ActionHandler<S, St> = (
  params: Record<string, unknown>,
  ctx: WidgetContext<S, St>,
  info: { actionId: string },
) => unknown;

/** The backend of one widget type. Every member is optional. */
export interface WidgetBackend<S, St> {
  /** The state of a widget that has none saved yet. */
  initialState?: St;
  onStart?(ctx: WidgetContext<S, St>): void | Promise<void>;
  onSettings?(ctx: WidgetContext<S, St>, previous: S): void | Promise<void>;
  onOverlayConnect?(ctx: WidgetContext<S, St>, overlay: OverlayHandle): void | Promise<void>;
  onStop?(ctx: WidgetContext<S, St>): void | Promise<void>;
  /** Handlers by action name. The returned (or resolved) value is the action's result. */
  actions?: Record<string, ActionHandler<S, St>>;
  /** Upgrades settings saved by an older version of the plugin. */
  migrateSettings?(
    settings: Record<string, unknown>,
    info: { from: string; to: string },
  ): Record<string, unknown> | Promise<Record<string, unknown>>;
}

/** A widget backend with its settings and state types erased, as the runtime sees it. */
export type AnyWidgetBackend = WidgetBackend<Record<string, unknown>, unknown>;

/** Types one widget backend. `S` and `St` are the author's types for settings and state. */
export function defineWidgetBackend<S = Record<string, unknown>, St = null>(
  backend: WidgetBackend<S, St>,
): AnyWidgetBackend {
  // Erases S and St. The runtime hands over the host's settings (validated against the
  // manifest schema) and the state this backend saved, so the author's types hold.
  return backend as unknown as AnyWidgetBackend;
}

export interface PluginBackendDefinition {
  /** Backends by widget type, as declared in overly.plugin.json. */
  widgets: Record<string, AnyWidgetBackend>;
}

/** The default export of a plugin's backend module. */
export function definePluginBackend(definition: PluginBackendDefinition): PluginBackendDefinition {
  return definition;
}
