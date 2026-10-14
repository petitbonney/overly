import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { OVERLY_VERSION, WS_CLOSE_SHUTDOWN } from '@overly/shared';
import type pino from 'pino';

import { openSettings, SETTINGS_FILE } from './config/settings.js';
import { listenError, StartupError } from './errors.js';
import { buildApp } from './http/app.js';
import { type ShutdownResult, ShutdownCoordinator } from './lifecycle/shutdown.js';
import { createLogger } from './logging/logger.js';
import { loadOrCreateSessionKey } from './security/session-key.js';
import { OneTimeTokens } from './security/tokens.js';
import { DocumentVersionError } from './storage/json-document.js';

export interface ServerOptions {
  dataDir: string;
  /** Overrides `server.port` from settings.json. */
  port: number | undefined;
  devOrigins: readonly string[];
  dashboardDir: string | undefined;
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
  const { app, hub } = await buildApp({
    logger,
    version: OVERLY_VERSION,
    getPort: () => port,
    devOrigins: options.devOrigins,
    sessionKey,
    tokens,
    dashboardDir: options.dashboardDir,
  });

  const requested = options.port ?? settings.get().server.port;
  try {
    await app.listen({ host: '127.0.0.1', port: requested });
  } catch (error) {
    await app.close();
    return fail(listenError(error, requested, settingsPath));
  }
  port = (app.server.address() as AddressInfo).port;
  logger.info({ port, dataDir }, 'Overly server listening');

  const shutdown = new ShutdownCoordinator({ logger });
  shutdown.add('websockets', () => {
    hub.closeAll(WS_CLOSE_SHUTDOWN, 'server shutting down');
  });
  shutdown.add('http', () => app.close());
  shutdown.add('documents', () => settings.flush());
  shutdown.add('logger', flush);

  return {
    port,
    logger,
    dashboardUrl: (origin = `http://127.0.0.1:${String(port)}`) => `${origin}/?t=${tokens.issue()}`,
    shutdown: (reason) => shutdown.run(reason),
  };
}
