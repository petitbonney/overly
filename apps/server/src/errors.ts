import type { FatalCode } from '@overly/shared';

/** An error that stops the server from starting. Reported to the shell as a `fatal` notification. */
export class StartupError extends Error {
  constructor(
    readonly code: FatalCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StartupError';
  }
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined;
}

/** Turns a `listen()` failure into a message a streamer can act on. */
export function listenError(error: unknown, port: number, settingsPath: string): StartupError {
  const where = `server.port in ${settingsPath}`;
  switch (errorCode(error)) {
    case 'EADDRINUSE':
      return new StartupError(
        'port_in_use',
        `Port ${String(port)} is already in use by another program. Close it, or change ${where}.`,
        { cause: error },
      );
    case 'EACCES':
      return new StartupError(
        'port_unavailable',
        `Port ${String(port)} can't be used (Windows may reserve it for Hyper-V or WSL). Change ${where}.`,
        { cause: error },
      );
    default:
      return new StartupError(
        'startup_failed',
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
  }
}
