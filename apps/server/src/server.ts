import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { OVERLY_VERSION, WS_CLOSE_SHUTDOWN } from '@overly/shared';
import type pino from 'pino';

import { AssetStore } from './assets/store.js';
import { openSettings, SETTINGS_FILE } from './config/settings.js';
import { listenError, StartupError } from './errors.js';
import { EventBus } from './events/bus.js';
import { buildApp } from './http/app.js';
import { type ShutdownResult, ShutdownCoordinator } from './lifecycle/shutdown.js';
import { createLogger } from './logging/logger.js';
import { BUILTIN_BACKENDS } from './plugins/builtin.js';
import { PluginRegistry } from './plugins/registry.js';
import { loadOrCreateSessionKey } from './security/session-key.js';
import { OneTimeTokens } from './security/tokens.js';
import { DocumentVersionError } from './storage/json-document.js';
import { OverlayHub } from './widgets/overlay-hub.js';
import { WidgetService } from './widgets/service.js';
import { WidgetStore } from './widgets/store.js';
import type { WsHub } from './ws/hub.js';

export interface ServerOptions {
  dataDir: string;
  /** Overrides `server.port` from settings.json. */
  port: number | undefined;
  devOrigins: readonly string[];
  dashboardDir: string | undefined;
  /** Folder of the built-in plugins. */
  pluginsDir: string;
  /** The built overlay SDK, served at /sdk/overlay.js. */
  overlaySdkPath: string;
  prettyLogs: boolean;
}

export interface RunningServer {
  readonly port: number;
  readonly logger: pino.Logger;
  /** A dashboard URL with a fresh one-time token. The origin defaults to http://127.0.0.1:<port>. */
  dashboardUrl(origin?: string): string;
  shutdown(reason: string): Promise<ShutdownResult>;
}

/** Starts the server: logger, settings, session key, HTTP app, then listen on 127.0.0.1. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const { dataDir } = options;
  const { logger, flush } = await createLogger({
    logDir: join(dataDir, 'logs'),
    pretty: options.prettyLogs,
  });
  const settingsPath = join(dataDir, SETTINGS_FILE);

  const fail = async (error: StartupError): Promise<never> => {
    logger.error({ err: error, code: error.code }, 'Overly could not start');
    await flush();
    throw error;
  };

  let settings;
  try {
    settings = await openSettings(dataDir, logger);
  } catch (error) {
    if (error instanceof DocumentVersionError) {
      return fail(
        new StartupError(
          'config_unsupported',
          `${settingsPath} was written by a newer version of Overly.`,
          { cause: error },
        ),
      );
    }
    throw error;
  }

  const sessionKey = await loadOrCreateSessionKey(dataDir);
  const tokens = new OneTimeTokens();
  let port = 0;

  const registry = await PluginRegistry.load({ pluginsDir: options.pluginsDir, logger });
  const store = await WidgetStore.open({ dir: join(dataDir, 'widgets'), logger });
  const assets = await AssetStore.open({ dir: join(dataDir, 'assets'), logger });
  const events = new EventBus({
    onListenerError: (error) => {
      logger.error({ err: error }, 'An event listener failed');
    },
  });
  // The hub and the services report to each other; they are created one after the other.
  const ref: { hub?: WsHub; widgets?: WidgetService } = {};
  const overlays = new OverlayHub({
    logger,
    onCountsChange: (widgetId) => {
      ref.widgets?.runtimeChanged(widgetId);
    },
  });
  const widgets = await WidgetService.open({
    store,
    registry,
    overlays,
    events,
    builtins: BUILTIN_BACKENDS,
    notify: (message) => {
      ref.hub?.broadcast(message);
    },
    overlayBaseUrl: () => `http://127.0.0.1:${String(port)}`,
    logger,
  });
  ref.widgets = widgets;

  const { app, hub } = await buildApp({
    logger,
    version: OVERLY_VERSION,
    getPort: () => port,
    devOrigins: options.devOrigins,
    sessionKey,
    tokens,
    dashboardDir: options.dashboardDir,
    widgets,
    registry,
    assets,
    overlays,
    overlaySdkPath: options.overlaySdkPath,
  });
  ref.hub = hub;

  const requested = options.port ?? settings.get().server.port;
  try {
    await app.listen({ host: '127.0.0.1', port: requested });
  } catch (error) {
    await app.close();
    await widgets.shutdown();
    return fail(listenError(error, requested, settingsPath));
  }
  port = (app.server.address() as AddressInfo).port;
  logger.info({ port, dataDir }, 'Overly server listening');

  const shutdown = new ShutdownCoordinator({ logger });
  shutdown.add('websockets', () => {
    hub.closeAll(WS_CLOSE_SHUTDOWN, 'server shutting down');
    overlays.closeAll(WS_CLOSE_SHUTDOWN, 'server shutting down');
  });
  shutdown.add('widgets', () => widgets.shutdown());
  shutdown.add('http', () => app.close());
  shutdown.add('documents', () =>
    Promise.all([settings.flush(), store.flush(), assets.flush()]).then(() => undefined),
  );
  shutdown.add('logger', flush);

  return {
    port,
    logger,
    dashboardUrl: (origin = `http://127.0.0.1:${String(port)}`) => `${origin}/?t=${tokens.issue()}`,
    shutdown: (reason) => shutdown.run(reason),
  };
}
