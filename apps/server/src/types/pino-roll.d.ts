// pino-roll ships no type definitions. This covers the options Overly uses.
declare module 'pino-roll' {
  import type { DestinationStream } from 'pino';

  export interface PinoRollOptions {
    file: string;
    size?: string | number;
    frequency?: string | number;
    extension?: string;
    mkdir?: boolean;
    symlink?: boolean;
    sync?: boolean;
    limit?: { count?: number; removeOtherLogFiles?: boolean };
  }

  /** A sonic-boom stream. */
  export interface PinoRollStream extends DestinationStream {
    flush(callback?: (error?: Error) => void): void;
    end(): void;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<PinoRollStream>;
}
