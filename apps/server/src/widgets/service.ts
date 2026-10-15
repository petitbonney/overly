import type { PluginBackendDefinition } from '@overly/sdk/backend';
import {
  type ApiErrorCode,
  type CreateWidgetBody,
  formatIssues,
  type Issue,
  type JsonValue,
  parseWidgetTypeRef,
  type ServerMessage,
  type UpdateWidgetBody,
  WIDGET_SCHEMA_VERSION,
  type WidgetDetail,
  type WidgetDocument,
  type WidgetProblem,
  type WidgetRuntime,
  type WidgetSummary,
} from '@overly/shared';
import type pino from 'pino';
import semver from 'semver';

import type { EventBus } from '../events/bus.js';
import type { PluginRegistry, WidgetTypeDef } from '../plugins/registry.js';
import { randomId } from '../util/random-id.js';
import { type BackendDelegate, BackendHost } from './backend-host.js';
import type { OverlayConnection, OverlayHub, OverlayOutcome } from './overlay-hub.js';
import type { StoredWidget, WidgetStore } from './store.js';

export const OVERLAY_CLOSE_DELETED_REASON = 'widget deleted';
const DEFAULT_OVERLAY_TIMEOUT_MS = 30_000;
const CLOSE_NOT_FOUND = 4404;

/** An error with the HTTP status and API error code the routes answer with. */
export class WidgetServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message?: string,
    readonly issues?: Issue[],
  ) {
    super(message ?? code);
    this.name = 'WidgetServiceError';
  }
}

export interface WidgetServiceOptions {
  store: WidgetStore;
  registry: PluginRegistry;
  overlays: OverlayHub;
  events: EventBus;
  builtins: Readonly<Record<string, PluginBackendDefinition>>;
  /** Broadcasts a message to every dashboard. */
  notify: (message: ServerMessage) => void;
  /** `http://127.0.0.1:<port>`, read when an overlay URL is built. */
  overlayBaseUrl: () => string;
  logger: pino.Logger;
  now?: () => Date;
}

function issueText(issues: readonly Issue[]): string {
  return issues
    .map(({ path, message }) => (path === '' ? message : `${path}: ${message}`))
    .join('; ');
}

/**
 * Widgets as the dashboard, overlays and backends see them: their status, settings, backend and
 * overlays. Routes call it; it is also the delegate for what plugin backends send.
 */
export class WidgetService implements BackendDelegate {
  readonly #store: WidgetStore;
  readonly #registry: PluginRegistry;
  readonly #overlays: OverlayHub;
  readonly #events: EventBus;
  readonly #notify: (message: ServerMessage) => void;
  readonly #overlayBaseUrl: () => string;
  readonly #logger: pino.Logger;
  readonly #now: () => Date;
  /** Problems of every widget; an empty list means ok. */
  readonly #problems = new Map<string, WidgetProblem[]>();
  /** Validated settings (defaults filled in) of widgets whose settings pass their schema. */
  readonly #settings = new Map<string, Record<string, unknown>>();
  #backends: BackendHost | undefined;

  private constructor(options: WidgetServiceOptions) {
    this.#store = options.store;
    this.#registry = options.registry;
    this.#overlays = options.overlays;
    this.#events = options.events;
    this.#notify = options.notify;
    this.#overlayBaseUrl = options.overlayBaseUrl;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  /** Starts plugin backends, migrates and checks every widget, then starts active widgets. */
  static async open(options: WidgetServiceOptions): Promise<WidgetService> {
    const service = new WidgetService(options);
    service.#backends = await BackendHost.start({
      registry: options.registry,
      builtins: options.builtins,
      delegate: service,
      logger: options.logger,
    });
    for (const entry of options.store.list()) await service.#load(entry);
    for (const entry of options.store.list()) {
      if (entry.kind === 'document') service.#startBackend(entry.doc.id);
    }
    return service;
  }

  has(id: string): boolean {
    return this.#store.get(id) !== undefined;
  }

  typeOf(id: string): WidgetTypeDef | undefined {
    const entry = this.#store.get(id);
    return entry?.kind === 'document' ? this.#registry.widgetType(entry.doc.type) : undefined;
  }

  /** Enabled and without problems: its backend runs and its overlays show. */
  isActive(id: string): boolean {
    const entry = this.#store.get(id);
    return (
      entry?.kind === 'document' && entry.doc.enabled && (this.#problems.get(id) ?? []).length === 0
    );
  }

  list(): WidgetSummary[] {
    return this.#store
      .list()
      .map((entry) => this.#summary(entry))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          a.id.localeCompare(b.id),
      );
  }

  detail(id: string): WidgetDetail {
    const entry = this.#require(id);
    const summary = this.#summary(entry);
    const type = entry.kind === 'document' ? this.#registry.widgetType(entry.doc.type) : undefined;
    const overlay = type?.decl.overlay;
    return {
      ...summary,
      settings: entry.kind === 'document' ? (this.#settings.get(id) ?? entry.doc.settings) : {},
      overlayUrl: overlay === undefined ? null : `${this.#overlayBaseUrl()}/o/${id}`,
      overlay: overlay === undefined ? null : { width: overlay.width, height: overlay.height },
      runtime: this.runtime(id),
    };
  }

  runtime(id: string): WidgetRuntime {
    return {
      overlays: this.#overlays.counts(id),
      queue: { pending: 0, running: null },
    };
  }

  /** Called when overlay counts or the queue change: tells dashboards. */
  runtimeChanged(id: string): void {
    if (!this.has(id)) return;
    this.#notify({ type: 'widget.runtime', widgetId: id, runtime: this.runtime(id) });
  }

  async create(body: CreateWidgetBody): Promise<WidgetDetail> {
    const type = this.#registry.widgetType(body.type);
    if (type === undefined) {
      throw new WidgetServiceError(404, 'widget_type_not_found', `No widget type ${body.type}`);
    }
    const now = this.#now().toISOString();
    const doc: WidgetDocument = {
      schemaVersion: WIDGET_SCHEMA_VERSION,
      id: this.#newId(),
      type: type.ref,
      name: body.name ?? this.#uniqueName(type.decl.name),
      enabled: true,
      pluginVersion: type.manifest.version,
      settings: type.defaults(),
      state: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.#store.create(doc);
    await this.#load({ kind: 'document', doc });
    this.#startBackend(doc.id);
    this.#changed(doc.id);
    return this.detail(doc.id);
  }

  async update(id: string, body: UpdateWidgetBody): Promise<WidgetDetail> {
    const doc = this.#requireDocument(id);
    const blocking = (this.#problems.get(id) ?? []).filter(
      (problem) => problem.code !== 'settings_invalid',
    );
    const [problem] = blocking;
    if (problem !== undefined) {
      throw new WidgetServiceError(
        409,
        'widget_broken',
        `This widget can't be changed: ${problem.message}`,
      );
    }

    let settings: Record<string, unknown> | undefined;
    if (body.settings !== undefined) {
      const type = this.typeOf(id);
      if (type === undefined) throw new WidgetServiceError(409, 'widget_broken');
      const result = type.settings.safeParse(body.settings);
      if (!result.success) {
        throw new WidgetServiceError(
          400,
          'invalid_settings',
          'Some settings are invalid',
          formatIssues(result.error),
        );
      }
      settings = result.data;
    }

    const wasActive = this.isActive(id);
    const next = await this.#store.update(id, (current) => ({
      ...current,
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
      ...(settings === undefined ? {} : { settings }),
    }));
    if (settings !== undefined) {
      this.#problems.set(id, []);
      this.#settings.set(id, settings);
    }
    const isActive = this.isActive(id);
    if (wasActive && !isActive) this.#stopBackend(id);
    if (settings !== undefined) {
      this.#overlays.send(id, { type: 'settings', settings });
      if (wasActive && isActive) this.#connection(id)?.updateSettings(id, settings);
    }
    if (!wasActive && isActive) this.#startBackend(id);
    if (next.name !== doc.name || wasActive !== isActive) {
      this.#overlays.send(id, { type: 'widget', name: next.name, active: isActive });
    }
    this.#changed(id);
    return this.detail(id);
  }

  async duplicate(id: string): Promise<WidgetDetail> {
    const source = this.#requireDocument(id);
    const now = this.#now().toISOString();
    const doc: WidgetDocument = {
      ...source,
      id: this.#newId(),
      name: `${source.name} (copy)`,
      state: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.#store.create(doc);
    await this.#load({ kind: 'document', doc });
    this.#startBackend(doc.id);
    this.#changed(doc.id);
    return this.detail(doc.id);
  }

  async delete(id: string): Promise<void> {
    this.#require(id);
    this.#stopBackend(id);
    this.#overlays.closeWidget(id, CLOSE_NOT_FOUND, OVERLAY_CLOSE_DELETED_REASON);
    await this.#store.delete(id);
    this.#problems.delete(id);
    this.#settings.delete(id);
    this.#changed(id);
  }

  /** Sends `init` to an overlay that just connected, then tells the backend about it. */
  overlayAttached(connection: OverlayConnection): void {
    const entry = this.#store.get(connection.widgetId);
    if (entry?.kind !== 'document') return;
    const { doc } = entry;
    const active = this.isActive(doc.id);
    this.#overlays.send(
      doc.id,
      {
        type: 'init',
        widget: { id: doc.id, name: doc.name, type: doc.type },
        active,
        settings: this.#settings.get(doc.id) ?? doc.settings,
      },
      connection.id,
    );
    if (active)
      this.#connection(doc.id)?.overlayConnected(doc.id, connection.id, connection.preview);
  }

  async shutdown(): Promise<void> {
    await this.#backends?.close();
  }

  // BackendDelegate: what plugin backends send.

  setState(widgetId: string, state: JsonValue): void {
    this.#store
      .update(widgetId, (doc) => ({ ...doc, state }))
      .catch((error: unknown) => {
        this.#logger.error({ err: error, widgetId }, 'Saving widget state failed');
      });
  }

  emitToOverlay(widgetId: string, name: string, payload: unknown, overlayId?: string): void {
    this.#overlays.send(widgetId, { type: 'message', name, payload }, overlayId);
  }

  overlayAction(
    widgetId: string,
    request: { name: string; params: unknown; timeoutMs: number | undefined },
  ): Promise<OverlayOutcome> {
    return this.#overlays.runAction(
      widgetId,
      request.name,
      request.params,
      request.timeoutMs ?? DEFAULT_OVERLAY_TIMEOUT_MS,
    );
  }

  emitEvent(widgetId: string, name: string, payload: unknown): void {
    const type = this.typeOf(widgetId);
    const schema = type?.events.get(name);
    if (type === undefined || schema === undefined) {
      this.#logger.warn(
        { widgetId, event: name },
        'Ignored an event the manifest does not declare',
      );
      return;
    }
    const result = schema.safeParse(payload ?? {});
    if (!result.success) {
      this.#logger.warn(
        { widgetId, event: name, issues: formatIssues(result.error) },
        'Ignored an event with an invalid payload',
      );
      return;
    }
    this.#events.publish({
      source: 'widget',
      widgetId,
      widgetType: type.ref,
      name,
      payload: result.data,
      at: this.#now().toISOString(),
    });
    this.#logger.debug({ widgetId, event: name }, 'Widget event');
  }

  // Internals.

  /** Computes a widget's problems, migrating its settings when its plugin was updated. */
  async #load(entry: StoredWidget): Promise<void> {
    if (entry.kind === 'unreadable') {
      this.#problems.set(entry.id, [{ code: entry.code, message: entry.reason }]);
      return;
    }
    let { doc } = entry;
    const problem = (code: WidgetProblem['code'], message: string): void => {
      this.#problems.set(doc.id, [{ code, message }]);
    };
    const ref = parseWidgetTypeRef(doc.type);
    const plugin = ref === undefined ? undefined : this.#registry.plugin(ref.pluginId);
    if (ref === undefined || plugin === undefined) {
      problem('plugin_missing', `The plugin ${ref?.pluginId ?? doc.type} is not installed.`);
      return;
    }
    if (plugin.status !== 'ok') {
      problem('plugin_broken', `The plugin ${plugin.name} could not be loaded.`);
      return;
    }
    const type = this.#registry.widgetType(doc.type);
    if (type === undefined) {
      problem('type_missing', `The plugin ${plugin.name} has no widget type "${ref.type}".`);
      return;
    }
    const installed = type.manifest.version;
    if (semver.gt(doc.pluginVersion, installed)) {
      problem(
        'newer_plugin_version',
        `This widget was saved by version ${doc.pluginVersion} of ${plugin.name}, but version ${installed} is installed.`,
      );
      return;
    }

    let settings = doc.settings;
    const upgraded = semver.lt(doc.pluginVersion, installed);
    if (upgraded) {
      const connection = this.#backends?.connection(type.pluginId);
      if (connection?.migrates(type.decl.type) === true) {
        try {
          settings = await connection.migrate(
            type.decl.type,
            settings,
            doc.pluginVersion,
            installed,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          problem('settings_invalid', `Migrating the settings failed: ${message}`);
          return;
        }
      }
    }
    const result = type.settings.safeParse(settings);
    if (!result.success) {
      problem(
        'settings_invalid',
        `Some settings are invalid: ${issueText(formatIssues(result.error))}`,
      );
      return;
    }
    if (upgraded) {
      doc = await this.#store.update(doc.id, (current) => ({
        ...current,
        settings: result.data,
        pluginVersion: installed,
      }));
      this.#logger.info(
        { widgetId: doc.id, from: entry.doc.pluginVersion, to: installed },
        'Migrated widget settings',
      );
    }
    this.#problems.set(doc.id, []);
    this.#settings.set(doc.id, result.data);
  }

  #summary(entry: StoredWidget): WidgetSummary {
    if (entry.kind === 'unreadable') {
      return {
        id: entry.id,
        name: entry.id,
        type: '',
        typeName: null,
        iconUrl: null,
        enabled: false,
        status: 'broken',
        problems: this.#problems.get(entry.id) ?? [],
      };
    }
    const { doc } = entry;
    const type = this.#registry.widgetType(doc.type);
    const problems = this.#problems.get(doc.id) ?? [];
    return {
      id: doc.id,
      name: doc.name,
      type: doc.type,
      typeName: type?.decl.name ?? null,
      iconUrl: type?.iconPath === undefined ? null : `/plugins/${type.pluginId}/${type.iconPath}`,
      enabled: doc.enabled,
      status: problems.length === 0 ? 'ok' : 'broken',
      problems,
    };
  }

  #require(id: string): StoredWidget {
    const entry = this.#store.get(id);
    if (entry === undefined) throw new WidgetServiceError(404, 'widget_not_found');
    return entry;
  }

  #requireDocument(id: string): WidgetDocument {
    const entry = this.#require(id);
    if (entry.kind !== 'document') {
      throw new WidgetServiceError(409, 'widget_broken', entry.reason);
    }
    return entry.doc;
  }

  #connection(id: string) {
    const type = this.typeOf(id);
    return type === undefined ? undefined : this.#backends?.connection(type.pluginId);
  }

  #startBackend(id: string): void {
    if (!this.isActive(id)) return;
    const entry = this.#store.get(id);
    const type = this.typeOf(id);
    const connection = this.#connection(id);
    if (entry?.kind !== 'document' || type === undefined || connection === undefined) return;
    if (connection.isStarted(id)) return;
    connection.startWidget({
      widgetId: id,
      widgetType: type.decl.type,
      widget: { id, name: entry.doc.name },
      settings: this.#settings.get(id) ?? entry.doc.settings,
      state: entry.doc.state,
    });
  }

  #stopBackend(id: string): void {
    this.#connection(id)?.stopWidget(id);
  }

  #changed(id: string): void {
    this.#notify({ type: 'widgets.changed', widgetId: id });
  }

  #newId(): string {
    let id = randomId();
    while (this.#store.get(id) !== undefined) id = randomId();
    return id;
  }

  #uniqueName(base: string): string {
    const taken = new Set(
      this.#store
        .list()
        .flatMap((entry) => (entry.kind === 'document' ? [entry.doc.name.toLowerCase()] : [])),
    );
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; ; n++) {
      const name = `${base} ${String(n)}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }
}
