import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PluginBackendDefinition } from '@overly/sdk/backend';
import type { ServerMessage, WidgetDocument } from '@overly/shared';
import pino from 'pino';

import { AssetStore } from '../assets/store.js';
import { EventBus } from '../events/bus.js';
import { PluginRegistry } from '../plugins/registry.js';
import { OverlayHub } from '../widgets/overlay-hub.js';
import { WidgetService } from '../widgets/service.js';
import { WidgetStore } from '../widgets/store.js';
import { fixtureManifest, type ManifestInput, writeTestPlugin } from './plugins.js';

export const TEST_OVERLAY_BASE_URL = 'http://127.0.0.1:6859';
export const TEST_WIDGET_ID = 'abcdefghij12';

/** A widget document for the fixture `counter` type, for files written before the service opens. */
export function counterDoc(overrides: Partial<WidgetDocument> = {}): WidgetDocument {
  return {
    schemaVersion: 1,
    id: TEST_WIDGET_ID,
    type: 'fixture.widgets:counter',
    name: 'Counter',
    enabled: true,
    pluginVersion: '1.0.0',
    settings: { label: 'Count', step: 1 },
    state: null,
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  };
}

export interface TestServices {
  service: WidgetService;
  assets: AssetStore;
  registry: PluginRegistry;
  store: WidgetStore;
  overlays: OverlayHub;
  events: EventBus;
  /** Every message the service broadcast to dashboards. */
  messages: ServerMessage[];
  dataDir: string;
  pluginsDir: string;
}

/**
 * Real registry, store, overlay hub and widget service in a temp folder, with the fixture
 * plugin (plus `extraPlugins`) and widget files written before the service opens.
 */
export async function createTestServices(
  options: {
    manifest?: ManifestInput;
    builtins?: Record<string, PluginBackendDefinition>;
    files?: Record<string, string | null>;
    extraPlugins?: Record<string, unknown>;
    widgetFiles?: Record<string, string>;
    now?: () => Date;
    /** Also receives every dashboard message (the recorded `messages` always do). */
    notify?: (message: ServerMessage) => void;
    overlayBaseUrl?: () => string;
    assetMaxBytes?: number;
  } = {},
): Promise<TestServices> {
  const logger = pino({ level: 'silent' });
  const root = await mkdtemp(join(tmpdir(), 'overly-services-'));
  const pluginsDir = join(root, 'plugins');
  const dataDir = join(root, 'data');
  await writeTestPlugin(pluginsDir, 'fixture', options.manifest ?? fixtureManifest(), {
    'src/backend.js': 'export default {};',
    ...options.files,
  });
  for (const [folder, manifest] of Object.entries(options.extraPlugins ?? {})) {
    await writeTestPlugin(pluginsDir, folder, manifest);
  }
  const widgetsDir = join(dataDir, 'widgets');
  await mkdir(widgetsDir, { recursive: true });
  for (const [name, content] of Object.entries(options.widgetFiles ?? {})) {
    await writeFile(join(widgetsDir, name), content);
  }

  const now = options.now ?? (() => new Date('2026-10-15T09:00:00.000Z'));
  const registry = await PluginRegistry.load({ pluginsDir, logger });
  const store = await WidgetStore.open({ dir: widgetsDir, logger, now });
  const events = new EventBus();
  const messages: ServerMessage[] = [];
  // The hub is built before the service it reports to.
  const ref: { service?: WidgetService } = {};
  const overlays = new OverlayHub({
    logger,
    onCountsChange: (widgetId) => {
      ref.service?.runtimeChanged(widgetId);
    },
  });
  const service = await WidgetService.open({
    store,
    registry,
    overlays,
    events,
    builtins: options.builtins ?? {},
    notify: (message) => {
      messages.push(message);
      options.notify?.(message);
    },
    overlayBaseUrl: options.overlayBaseUrl ?? (() => TEST_OVERLAY_BASE_URL),
    logger,
    now,
  });
  ref.service = service;
  const assets = await AssetStore.open({
    dir: join(dataDir, 'assets'),
    logger,
    now,
    ...(options.assetMaxBytes === undefined ? {} : { maxBytes: options.assetMaxBytes }),
  });
  return { service, assets, registry, store, overlays, events, messages, dataDir, pluginsDir };
}
