import type { WidgetActionMessage } from '@overly/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ServerSocket,
  ServerConnectionProvider,
  useActionUpdates,
  useConnectionStatus,
} from './ServerConnection.js';

class FakeSocket implements ServerSocket {
  static instances: FakeSocket[] = [];
  onopen: ServerSocket['onopen'] = null;
  onclose: ServerSocket['onclose'] = null;
  onmessage: ServerSocket['onmessage'] = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    act(() => {
      this.onopen?.(new Event('open'));
    });
  }

  drop(): void {
    act(() => {
      this.onclose?.(new CloseEvent('close', { code: 1006 }));
    });
  }

  receive(message: unknown): void {
    act(() => {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
    });
  }
}

function Status() {
  return <p>{useConnectionStatus()}</p>;
}

let client: QueryClient;

function renderConnection(url?: string, children = <Status />) {
  client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ServerConnectionProvider
        createSocket={(target) => new FakeSocket(target)}
        {...(url === undefined ? {} : { url })}
      >
        {children}
      </ServerConnectionProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  FakeSocket.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerConnectionProvider', () => {
  it('connects to ws://<host>/ws by default', () => {
    renderConnection();
    expect(FakeSocket.instances[0]?.url).toBe(`ws://${location.host}/ws`);
    expect(screen.getByText('connecting')).toBeInTheDocument();
  });

  it('reports connected after open, then reconnecting after close', () => {
    renderConnection('ws://test/ws');
    const socket = FakeSocket.instances[0];
    socket?.open();
    expect(screen.getByText('connected')).toBeInTheDocument();
    socket?.drop();
    expect(screen.getByText('reconnecting')).toBeInTheDocument();
  });

  it('reconnects after the backoff delay', () => {
    vi.useFakeTimers();
    renderConnection('ws://test/ws');
    FakeSocket.instances[0]?.drop();
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(FakeSocket.instances).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    FakeSocket.instances[1]?.open();
    expect(screen.getByText('connected')).toBeInTheDocument();
  });

  it('closes the socket and stops reconnecting on unmount', () => {
    vi.useFakeTimers();
    const { unmount } = renderConnection('ws://test/ws');
    const socket = FakeSocket.instances[0];
    unmount();
    expect(socket?.closed).toBe(true);
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

describe('reconnecting', () => {
  it('refreshes every query after reconnecting, not on the first connection', () => {
    vi.useFakeTimers();
    renderConnection('ws://test/ws');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    FakeSocket.instances[0]?.open();
    expect(invalidate).not.toHaveBeenCalled();
    FakeSocket.instances[0]?.drop();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    FakeSocket.instances[1]?.open();
    // Messages sent while disconnected (runtime counts, widget changes) were missed.
    expect(invalidate).toHaveBeenCalledWith();
  });
});

describe('server messages', () => {
  const W = 'abcdefghij12';

  it('invalidates widget queries on widgets.changed', () => {
    renderConnection('ws://test/ws');
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    FakeSocket.instances[0]?.receive({ type: 'widgets.changed', widgetId: W });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['widgets'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['widget', W] });
  });

  it('patches the cached runtime on widget.runtime', () => {
    renderConnection('ws://test/ws');
    client.setQueryData(['widget', W], { id: W, name: 'Alerts', runtime: null });
    const runtime = { overlays: { live: 1, preview: 0 }, queue: { pending: 2, running: 'show' } };
    FakeSocket.instances[0]?.receive({ type: 'widget.runtime', widgetId: W, runtime });
    expect(client.getQueryData(['widget', W])).toEqual({ id: W, name: 'Alerts', runtime });
  });

  it('passes widget.action messages to subscribers', () => {
    const seen: WidgetActionMessage[] = [];
    function Listener() {
      useActionUpdates((message) => seen.push(message));
      return null;
    }
    renderConnection('ws://test/ws', <Listener />);
    FakeSocket.instances[0]?.receive({
      type: 'widget.action',
      widgetId: W,
      actionId: 'a1',
      action: 'show',
      status: 'done',
    });
    FakeSocket.instances[0]?.receive({ type: 'widget.action', widgetId: W });
    expect(seen).toEqual([
      {
        type: 'widget.action',
        widgetId: W,
        actionId: 'a1',
        action: 'show',
        status: 'done',
        warnings: [],
      },
    ]);
  });
});
