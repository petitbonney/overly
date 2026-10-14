import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type ServerSocket,
  ServerConnectionProvider,
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
}

function Status() {
  return <p>{useConnectionStatus()}</p>;
}

function renderConnection(url?: string) {
  return render(
    <ServerConnectionProvider
      createSocket={(target) => new FakeSocket(target)}
      {...(url === undefined ? {} : { url })}
    >
      <Status />
    </ServerConnectionProvider>,
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
