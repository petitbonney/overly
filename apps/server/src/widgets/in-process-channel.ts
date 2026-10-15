import type { ChannelEnd } from '@overly/shared';

interface Shared {
  closed: boolean;
}

class InProcessEnd implements ChannelEnd {
  peer: InProcessEnd | undefined;
  #handler: ((message: unknown) => void) | undefined;
  readonly #shared: Shared;

  constructor(shared: Shared) {
    this.#shared = shared;
  }

  send(message: unknown): void {
    if (this.#shared.closed) return;
    // A JSON round trip, as a child process pipe would do: anything JSON can't carry fails here,
    // on the sending side, instead of working in-process and breaking in Phase 8.
    const copy: unknown = JSON.parse(JSON.stringify(message));
    queueMicrotask(() => {
      if (!this.#shared.closed) this.peer?.deliver(copy);
    });
  }

  onMessage(handler: (message: unknown) => void): void {
    this.#handler = handler;
  }

  close(): void {
    this.#shared.closed = true;
  }

  deliver(message: unknown): void {
    this.#handler?.(message);
  }
}

/**
 * A message channel between the host and a built-in plugin backend running in the same process.
 * Messages are JSON-cloned and delivered in order in a microtask. Closing either end closes both.
 */
export function createInProcessChannel(): [host: ChannelEnd, backend: ChannelEnd] {
  const shared: Shared = { closed: false };
  const host = new InProcessEnd(shared);
  const backend = new InProcessEnd(shared);
  host.peer = backend;
  backend.peer = host;
  return [host, backend];
}
