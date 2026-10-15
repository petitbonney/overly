import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  type DashboardUrlResult,
  type FatalParams,
  OVERLY_VERSION,
  type ReadyParams,
  SidecarMethod,
} from '@overly/shared';

import { type CliOptions, parseCliArgs } from './cli.js';
import { resolveDataDir } from './config/data-dir.js';
import { StartupError } from './errors.js';
import { type RpcLogger, RpcPeer } from './rpc/peer.js';
import { type RunningServer, startServer } from './server.js';

// Entry point of the sidecar. stdout belongs to JSON-RPC in --rpc mode: write text to stderr only.

function printError(text: string): void {
  process.stderr.write(`${text}\n`);
}

const stderrLogger: RpcLogger = {
  warn: (_obj, msg) => {
    printError(msg);
  },
  error: (_obj, msg) => {
    printError(msg);
  },
};

async function reportFatal(options: CliOptions, error: unknown): Promise<void> {
  const fatal =
    error instanceof StartupError
      ? error
      : new StartupError('startup_failed', error instanceof Error ? error.message : String(error));
  printError(`Overly can't start: ${fatal.message}`);
  if (options.rpc) {
    const peer = new RpcPeer(process.stdin, process.stdout, { logger: stderrLogger });
    const params: FatalParams = { code: fatal.code, message: fatal.message };
    await peer.notify(SidecarMethod.fatal, params);
    await peer.drain();
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 2;
  }

  const dataDir = resolveDataDir({
    platform: process.platform,
    env: process.env,
    homedir: homedir(),
    cwd: process.cwd(),
    override: options.dataDir,
  });
  const dashboardDir =
    options.dashboardDir === undefined
      ? fileURLToPath(new URL('./dashboard/', import.meta.url))
      : resolve(options.dashboardDir);

  const pluginsDir =
    options.pluginsDir === undefined
      ? fileURLToPath(new URL('./plugins/', import.meta.url))
      : resolve(options.pluginsDir);

  let server: RunningServer;
  try {
    server = await startServer({
      dataDir,
      port: options.port,
      devOrigins: options.devOrigins,
      dashboardDir,
      pluginsDir,
      prettyLogs: options.prettyLogs,
    });
  } catch (error) {
    await reportFatal(options, error);
    return 1;
  }

  let peer: RpcPeer | undefined;
  const exitCode = await new Promise<number>((resolveExit) => {
    const stop = (reason: string): void => {
      void server.shutdown(reason).then(({ exitCode: code }) => {
        resolveExit(code);
      });
    };
    process.once('SIGINT', () => {
      stop('SIGINT');
    });
    process.once('SIGTERM', () => {
      stop('SIGTERM');
    });

    if (options.rpc) {
      peer = new RpcPeer(process.stdin, process.stdout, { logger: server.logger });
      peer.handle(SidecarMethod.getDashboardUrl, (): DashboardUrlResult => ({
        url: server.dashboardUrl(),
      }));
      peer.handle(SidecarMethod.shutdown, () => {
        // Answer first: the response is written before the shutdown starts.
        setImmediate(() => {
          stop('shutdown request');
        });
        return {};
      });
      void peer.closed.then(() => {
        stop('stdin closed');
      });
      const ready: ReadyParams = { port: server.port, version: OVERLY_VERSION };
      void peer.notify(SidecarMethod.ready, ready);
    } else {
      printError(
        `Overly is running. Open the dashboard: ${server.dashboardUrl(options.devOrigins[0])}`,
      );
    }
  });

  await peer?.drain();
  return exitCode;
}

// Exit explicitly: stdin and signal listeners would otherwise keep the process alive.
process.exit(await main(process.argv.slice(2)));
