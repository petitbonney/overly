import {
  reconnectDelay,
  type ServerMessage,
  ServerMessageSchema,
  type WidgetActionMessage,
  type WidgetDetail,
} from '@overly/shared';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

/** The part of a WebSocket the connection uses, so tests can pass a fake. */
export interface ServerSocket {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

type ActionListener = (message: WidgetActionMessage) => void;

interface ConnectionContextValue {
  status: ConnectionStatus;
  subscribe: (listener: ActionListener) => () => void;
}

const ConnectionContext = createContext<ConnectionContextValue>({
  status: 'connecting',
  subscribe: () => () => undefined,
});

function defaultUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function defaultCreateSocket(url: string): ServerSocket {
  return new WebSocket(url);
}

function parseMessage(event: MessageEvent): ServerMessage | undefined {
  if (typeof event.data !== 'string') return undefined;
  try {
    const result = ServerMessageSchema.safeParse(JSON.parse(event.data));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Keeps the TanStack Query cache in step with what the server broadcasts. */
function applyMessage(
  client: QueryClient,
  listeners: ReadonlySet<ActionListener>,
  message: ServerMessage,
): void {
  switch (message.type) {
    case 'hello':
      return;
    case 'widgets.changed':
      void client.invalidateQueries({ queryKey: ['widgets'] });
      if (message.widgetId !== undefined) {
        void client.invalidateQueries({ queryKey: ['widget', message.widgetId] });
      }
      return;
    case 'widget.runtime':
      client.setQueryData<WidgetDetail>(['widget', message.widgetId], (old) =>
        old === undefined ? old : { ...old, runtime: message.runtime },
      );
      return;
    case 'widget.action':
      for (const listener of listeners) listener(message);
      return;
  }
}

/**
 * Keeps one WebSocket to the server open, reconnecting with backoff. Shares its status, applies
 * widget updates to the query cache, and passes action progress to subscribers.
 */
export function ServerConnectionProvider({
  children,
  url,
  createSocket = defaultCreateSocket,
}: {
  children: ReactNode;
  url?: string;
  createSocket?: (url: string) => ServerSocket;
}) {
  const client = useQueryClient();
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const listeners = useRef(new Set<ActionListener>());

  useEffect(() => {
    const target = url ?? defaultUrl();
    let socket: ServerSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;

    const connect = (): void => {
      socket = createSocket(target);
      socket.onopen = () => {
        attempt = 0;
        setStatus('connected');
      };
      socket.onmessage = (event) => {
        const message = parseMessage(event);
        if (message !== undefined) applyMessage(client, listeners.current, message);
      };
      socket.onclose = () => {
        if (stopped) return;
        setStatus('reconnecting');
        timer = setTimeout(connect, reconnectDelay(attempt));
        attempt += 1;
      };
    };
    connect();

    return () => {
      stopped = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [url, createSocket, client]);

  const value = useMemo<ConnectionContextValue>(
    () => ({
      status,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [status],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionContext).status;
}

/** Calls `listener` for every `widget.action` message, while the component is mounted. */
export function useActionUpdates(listener: ActionListener): void {
  const { subscribe } = useContext(ConnectionContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(
    () =>
      subscribe((message) => {
        latest.current(message);
      }),
    [subscribe],
  );
}
