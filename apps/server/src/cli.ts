import { parseArgs } from 'node:util';

export interface CliOptions {
  /** Started by the shell: stdout carries JSON-RPC, and stdin closing means shut down. */
  rpc: boolean;
  dataDir: string | undefined;
  /** Overrides settings.json for this run only. 0 picks a free port. */
  port: number | undefined;
  devOrigins: string[];
  dashboardDir: string | undefined;
  pluginsDir: string | undefined;
  prettyLogs: boolean;
}

export class UsageError extends Error {
  override name = 'UsageError';
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        rpc: { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
        port: { type: 'string' },
        'dev-origin': { type: 'string', multiple: true, default: [] },
        'dashboard-dir': { type: 'string' },
        'plugins-dir': { type: 'string' },
        'pretty-logs': { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }

  let port: number | undefined;
  if (values.port !== undefined) {
    port = /^\d+$/.test(values.port) ? Number(values.port) : Number.NaN;
    if (!(port >= 0 && port <= 65535)) {
      throw new UsageError(`--port must be a number from 0 to 65535, got "${values.port}"`);
    }
  }

  return {
    rpc: values.rpc,
    dataDir: values['data-dir'],
    port,
    devOrigins: values['dev-origin'],
    dashboardDir: values['dashboard-dir'],
    pluginsDir: values['plugins-dir'],
    prettyLogs: values['pretty-logs'],
  };
}
