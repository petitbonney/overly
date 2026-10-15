import { writeFileAtomic } from './atomic-write.js';

/**
 * Writes one file, one write at a time. While a write is in flight only the newest pending
 * content is kept, so bursts of changes cost at most two writes.
 */
export class SerializedWriter {
  readonly #path: string;
  readonly #write: (path: string, data: string) => Promise<void>;
  #pending: string | undefined;
  #writing: Promise<void> | undefined;

  constructor(
    path: string,
    write: (path: string, data: string) => Promise<void> = writeFileAtomic,
  ) {
    this.#path = path;
    this.#write = write;
  }

  /** Writes `data` after the write in flight. Resolves when it (or newer content) is on disk. */
  schedule(data: string): Promise<void> {
    this.#pending = data;
    this.#writing ??= this.#drain();
    return this.#writing;
  }

  /** Resolves when everything scheduled so far is on disk. */
  flush(): Promise<void> {
    if (this.#pending !== undefined && this.#writing === undefined) {
      this.#writing = this.#drain();
    }
    return this.#writing ?? Promise.resolve();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#pending !== undefined) {
        const data = this.#pending;
        this.#pending = undefined;
        await this.#write(this.#path, data);
      }
    } finally {
      this.#writing = undefined;
    }
  }
}
