import { ServerMessageSchema } from '@overly/shared';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { reconnectDelay } from './backoff.js';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting';

/** The part of a WebSocket the connection uses, so tests can pass a fake. */
export interface ServerSocket {
  onopen: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
}

const ConnectionContext = createContext<ConnectionStatus>('connecting');

function defaultUrl(): string {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function defaultCreateSocket(url: string): ServerSocket {
  return new WebSocket(url);
}

function handleMessage(event: MessageEvent): void {
  if (typeof event.data !== 'string') return;
  let json: unknown;
  try {
    json = JSON.parse(event.data);
  } catch {
    return;
  }
  // Phase 1 only receives `hello`. Messages that fail the schema are ignored.
  ServerMessageSchema.safeParse(json);
}

/** Keeps one WebSocket to the server open, reconnecting with backoff, and shares its status. */
export function ServerConnectionProvider({
  children,
  url,
  createSocket = defaultCreateSocket,
}: {
  children: ReactNode;
  url?: string;
  createSocket?: (url: string) => ServerSocket;
}) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');

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
      socket.onmessage = handleMessage;
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
  }, [url, createSocket]);

  return <ConnectionContext.Provider value={status}>{children}</ConnectionContext.Provider>;
}

export function useConnectionStatus(): ConnectionStatus {
  return useContext(ConnectionContext);
}
