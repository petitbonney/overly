import { join } from 'node:path';

import pino from 'pino';
import pinoRoll from 'pino-roll';

const REDACTED = '[redacted]';

/** Hides the one-time dashboard token (`?t=`), so it never reaches a log file. */
export function redactUrl(url: string): string {
  const query = url.indexOf('?');
  if (query === -1) return url;
  const params = new URLSearchParams(url.slice(query + 1));
  if (!params.has('t')) return url;
  params.set('t', REDACTED);
  return `${url.slice(0, query)}?${params.toString()}`;
}

interface LoggedRequest {
  method?: string;
  url?: string;
  host?: string;
}

interface LoggedReply {
  statusCode?: number;
}

/** Shared by the file logger and tests. Fastify's request logs go through these serializers. */
export const loggerOptions: pino.LoggerOptions = {
  redact: ['req.headers.cookie', 'res.headers["set-cookie"]'],
  serializers: {
    req: (req: LoggedRequest) => ({
      method: req.method,
      url: req.url === undefined ? undefined : redactUrl(req.url),
      host: req.host,
    }),
    res: (res: LoggedReply) => ({ statusCode: res.statusCode }),
    err: pino.stdSerializers.err,
  },
};

export interface AppLogger {
  logger: pino.Logger;
  /** Resolves when everything logged so far is written. */
  flush: () => Promise<void>;
}

interface Flushable {
  flush(callback?: (error?: Error) => void): void;
}

/**
 * Logs JSON lines to `<logDir>/overly.<n>.log`: 10 MB per file, 5 files kept.
 * With `pretty`, also writes readable lines to stderr. Never writes to stdout, which belongs to
 * JSON-RPC when the shell runs the server.
 */
export async function createLogger(options: {
  logDir: string;
  pretty: boolean;
  level?: string;
  /** Size before a new file starts. Tests shrink it to force rotation. */
  maxSize?: string;
}): Promise<AppLogger> {
  const level = options.level ?? 'info';
  const file = await pinoRoll({
    file: join(options.logDir, 'overly'),
    extension: '.log',
    size: options.maxSize ?? '10m',
    // 5 files in total. removeOtherLogFiles also prunes files from earlier runs: without it,
    // pino-roll only removes files the current process created, so restarts pile them up.
    limit: { count: 5, removeOtherLogFiles: true },
    mkdir: true,
    // Synchronous writes: nothing is lost if the process dies, and flush() is deterministic.
    sync: true,
  });
  const streams: pino.StreamEntry[] = [{ level: level as pino.Level, stream: file }];
  const flushables: Flushable[] = [file];

  if (options.pretty) {
    // Dynamic import: pino-pretty is a dev dependency and stays out of the bundle.
    const { default: pretty } = await import('pino-pretty');
    const stream = pretty({ destination: 2, colorize: true, sync: true });
    streams.push({ level: level as pino.Level, stream });
  }

  const logger = pino({ ...loggerOptions, level }, pino.multistream(streams));
  return {
    logger,
    flush: () =>
      Promise.all(
        flushables.map(
          (stream) =>
            new Promise<void>((resolve) => {
              stream.flush(() => {
                resolve();
              });
            }),
        ),
      ).then(() => undefined),
  };
}
