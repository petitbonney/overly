/** Something a widget did (`alert.finished`), for pipelines (Phase 5). */
export interface WidgetEvent {
  source: 'widget';
  widgetId: string;
  /** `<pluginId>:<type>` */
  widgetType: string;
  name: string;
  payload: Record<string, unknown>;
  at: string;
}

type Listener = (event: WidgetEvent) => void;

/**
 * The server's internal event bus. Phase 2 carries widget events; Phase 3 adds platform events
 * (chat, subs…), and Phase 4 subscribes pipeline triggers.
 */
export class EventBus {
  readonly #listeners = new Set<Listener>();
  readonly #onListenerError: ((error: unknown) => void) | undefined;

  constructor(options: { onListenerError?: (error: unknown) => void } = {}) {
    this.#onListenerError = options.onListenerError;
  }

  publish(event: WidgetEvent): void {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch (error) {
        // One broken listener must not stop the others.
        this.#onListenerError?.(error);
      }
    }
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}
