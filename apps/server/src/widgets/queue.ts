export class QueueFullError extends Error {
  constructor(maxLength: number) {
    super(`The queue already holds ${String(maxLength)} waiting actions`);
    this.name = 'QueueFullError';
  }
}

export type QueueOutcome<T> =
  | { status: 'completed'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'cancelled' };

export interface QueueSnapshot {
  pending: number;
  running: string | null;
}

interface Entry {
  name: string;
  priority: number;
  seq: number;
  start(): Promise<void>;
  cancel(): void;
}

/**
 * A widget's queue of actions that take time (alerts). One item runs at a time; waiting items
 * run by priority (highest first), then in arrival order. Timeouts belong to the caller: an item
 * finishes when its `run` settles.
 */
export class ActionQueue {
  readonly #maxLength: number;
  readonly #onChange: ((snapshot: QueueSnapshot) => void) | undefined;
  readonly #waiting: Entry[] = [];
  #current: Entry | undefined;
  #seq = 0;

  constructor(options: { maxLength: number; onChange?: (snapshot: QueueSnapshot) => void }) {
    this.#maxLength = options.maxLength;
    this.#onChange = options.onChange;
  }

  get pending(): number {
    return this.#waiting.length;
  }

  get running(): string | null {
    return this.#current?.name ?? null;
  }

  /** Throws `QueueFullError` at once when `maxLength` items already wait. */
  push<T>(item: {
    name: string;
    priority: number;
    run: () => Promise<T>;
  }): Promise<QueueOutcome<T>> {
    if (this.#waiting.length >= this.#maxLength) throw new QueueFullError(this.#maxLength);
    return new Promise<QueueOutcome<T>>((resolve) => {
      const entry: Entry = {
        name: item.name,
        priority: item.priority,
        seq: this.#seq++,
        start: async () => {
          try {
            resolve({ status: 'completed', value: await item.run() });
          } catch (error) {
            resolve({ status: 'failed', error });
          }
        },
        cancel: () => {
          resolve({ status: 'cancelled' });
        },
      };
      this.#waiting.push(entry);
      this.#waiting.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      if (this.#current === undefined) this.#next();
      else this.#emit();
    });
  }

  /** Resolves every waiting item as `cancelled`. The running item is left to finish. */
  cancelAll(): void {
    const cancelled = this.#waiting.splice(0);
    for (const entry of cancelled) entry.cancel();
    if (cancelled.length > 0) this.#emit();
  }

  #next(): void {
    const entry = this.#waiting.shift();
    this.#current = entry;
    // Start first, then report: the item's own "started" signals come before the snapshot.
    void entry?.start().finally(() => {
      this.#next();
    });
    this.#emit();
  }

  #emit(): void {
    this.#onChange?.({ pending: this.pending, running: this.running });
  }
}
