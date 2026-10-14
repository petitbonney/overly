export interface ShutdownLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

export interface ShutdownResult {
  exitCode: 0 | 1;
}

export const SHUTDOWN_DEADLINE_MS = 5_000;

type Step = () => Promise<void> | void;

/**
 * Runs shutdown steps one at a time, in the order they were added, within a deadline. A failing
 * step is logged and the next one still runs, so logs get flushed even when something breaks.
 */
export class ShutdownCoordinator {
  readonly #logger: ShutdownLogger;
  readonly #deadlineMs: number;
  readonly #steps: { name: string; step: Step }[] = [];
  #running: Promise<ShutdownResult> | undefined;

  constructor(options: { logger: ShutdownLogger; deadlineMs?: number }) {
    this.#logger = options.logger;
    this.#deadlineMs = options.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
  }

  get started(): boolean {
    return this.#running !== undefined;
  }

  add(name: string, step: Step): void {
    this.#steps.push({ name, step });
  }

  run(reason: string): Promise<ShutdownResult> {
    this.#running ??= this.#run(reason);
    return this.#running;
  }

  async #run(reason: string): Promise<ShutdownResult> {
    this.#logger.info({ reason }, 'Shutting down');
    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<ShutdownResult>((resolve) => {
      timer = setTimeout(() => {
        this.#logger.error({ deadlineMs: this.#deadlineMs }, 'Shutdown deadline exceeded');
        resolve({ exitCode: 1 });
      }, this.#deadlineMs);
      timer.unref();
    });
    try {
      return await Promise.race([this.#runSteps(), deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  async #runSteps(): Promise<ShutdownResult> {
    let exitCode: 0 | 1 = 0;
    for (const { name, step } of this.#steps) {
      try {
        await step();
      } catch (error) {
        exitCode = 1;
        this.#logger.error({ err: error, step: name }, 'Shutdown step failed');
      }
    }
    return { exitCode };
  }
}
