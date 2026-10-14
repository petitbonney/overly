import { focusManager } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test/render.js';
import { SessionGate } from './SessionGate.js';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SessionGate', () => {
  it('shows the no-session screen on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'no_session' })));
    renderWithProviders(
      <SessionGate retryDelayMs={0}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByRole('heading', { name: 'No active session' })).toBeInTheDocument();
    expect(screen.getByText('Open the dashboard from the Overly tray icon.')).toBeInTheDocument();
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
  });

  it('renders the dashboard when the session is valid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { authenticated: true })));
    renderWithProviders(
      <SessionGate retryDelayMs={0}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
  });

  it('offers a retry when the server is unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <SessionGate retryDelayMs={0}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByText("Can't reach the Overly server.")).toBeInTheDocument();
    const calls = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValue(json(200, { authenticated: true }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('dashboard')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(calls);
    });
  });

  it('keeps the dashboard when a background check fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <SessionGate retryDelayMs={0}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByText('dashboard')).toBeInTheDocument();

    // The server restarts; refocusing the window checks the session again and fails.
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const calls = fetchMock.mock.calls.length;
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(calls + 3);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText('dashboard')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach the Overly server.")).not.toBeInTheDocument();
  });

  it('shows the no-session screen when the session ends', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { authenticated: true }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(
      <SessionGate retryDelayMs={0}>
        <p>dashboard</p>
      </SessionGate>,
    );
    expect(await screen.findByText('dashboard')).toBeInTheDocument();

    fetchMock.mockResolvedValue(json(401, { error: 'no_session' }));
    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    expect(await screen.findByRole('heading', { name: 'No active session' })).toBeInTheDocument();
  });
});
