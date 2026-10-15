import type { WidgetDetail } from '@overly/shared';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ServerSocket, ServerConnectionProvider } from '../connection/ServerConnection.js';
import { type ApiCall, mockApi } from '../test/api.js';
import { detail, okPlugins } from '../test/fixtures.js';
import { renderWithProviders } from '../test/render.js';
import { WidgetPageRoute } from './WidgetPage.js';

const W = 'abcdefghij12';

class FakeSocket implements ServerSocket {
  static latest: FakeSocket | undefined;
  onopen: ServerSocket['onopen'] = null;
  onclose: ServerSocket['onclose'] = null;
  onmessage: ServerSocket['onmessage'] = null;
  constructor() {
    FakeSocket.latest = this;
  }
  close(): void {
    // Not needed.
  }
  receive(message: unknown): void {
    act(() => {
      this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
    });
  }
}

function api(widget: WidgetDetail | 'gone' = detail()): ApiCall[] {
  return mockApi(({ method, url, body }) => {
    if (method === 'GET' && url === `/api/widgets/${W}`) {
      return widget === 'gone'
        ? { status: 404, body: { error: 'widget_not_found' } }
        : { body: widget };
    }
    if (method === 'GET' && url === '/api/plugins') return { body: { plugins: okPlugins } };
    if (method === 'GET' && url === '/api/widgets') return { body: { widgets: [] } };
    if (method === 'PATCH' && widget !== 'gone') {
      return { body: { ...widget, ...(body as Partial<WidgetDetail>) } };
    }
    if (method === 'POST' && url === `/api/widgets/${W}/actions/show-alert`) {
      return { status: 202, body: { actionId: 'action000001', status: 'running' } };
    }
    if (method === 'POST' && url === `/api/widgets/${W}/duplicate`) {
      return { status: 201, body: detail({ id: 'copycopycopy', name: 'Alerts (copy)' }) };
    }
    if (method === 'DELETE') return { status: 204 };
    return undefined;
  });
}

function renderPage() {
  return renderWithProviders(
    <ServerConnectionProvider url="ws://test/ws" createSocket={() => new FakeSocket()}>
      <Routes>
        <Route path="/widgets/:widgetId" element={<WidgetPageRoute />} />
        <Route path="/" element={<p>Home page</p>} />
      </Routes>
    </ServerConnectionProvider>,
    { route: `/widgets/${W}` },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WidgetPage', () => {
  it('shows the overlay URL from the API', async () => {
    api();
    renderPage();
    expect(
      await screen.findByDisplayValue('http://127.0.0.1:6860/o/abcdefghij12'),
    ).toBeInTheDocument();
    expect(window.location.host).not.toBe('127.0.0.1:6860');
    expect(screen.getByText('Recommended Browser Source size: 1920 × 1080')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
  });

  it('shows the connection status', async () => {
    api();
    renderPage();
    expect(await screen.findByText('Not in OBS yet')).toBeInTheDocument();
    FakeSocket.latest?.receive({
      type: 'widget.runtime',
      widgetId: W,
      runtime: { overlays: { live: 2, preview: 1 }, queue: { pending: 0, running: null } },
    });
    expect(await screen.findByText('2 overlays connected')).toBeInTheDocument();
  });

  it('renders a sandboxed, muted preview', async () => {
    api();
    const user = userEvent.setup();
    renderPage();
    const frame = await screen.findByTitle('Overlay preview');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('src', `/o/${W}?preview=1`);
    await user.click(screen.getByRole('button', { name: 'Unmute' }));
    expect(screen.getByTitle('Overlay preview')).toHaveAttribute(
      'src',
      `/o/${W}?preview=1&muted=0`,
    );
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
  });

  it('posts valid draft settings to the preview', async () => {
    api();
    const user = userEvent.setup();
    renderPage();
    const frame = await screen.findByTitle<HTMLIFrameElement>('Overlay preview');
    const target = frame.contentWindow;
    if (target === null) throw new Error('no frame window');
    const post = vi.spyOn(target, 'postMessage');
    const input = await screen.findByLabelText('Text template');
    await user.clear(input);
    await user.type(input, 'Hi');
    await waitFor(() => {
      expect(post).toHaveBeenLastCalledWith(
        {
          source: 'overly-dashboard',
          type: 'draft-settings',
          settings: { textTemplate: 'Hi', volume: 80 },
        },
        '*',
      );
    });
  });

  it('runs an action with its sample and shows the result', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Test: Show alert' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')).toEqual({
        method: 'POST',
        url: `/api/widgets/${W}/actions/show-alert`,
        body: { params: { title: 'Ada just followed!' } },
      });
    });
    FakeSocket.latest?.receive({
      type: 'widget.action',
      widgetId: W,
      actionId: 'action000001',
      action: 'show-alert',
      status: 'done',
      warnings: ['no_overlay'],
    });
    expect(
      await screen.findByText(
        'Done, but no overlay is connected: add the URL to OBS or keep the preview open',
      ),
    ).toBeInTheDocument();
  });

  it('saves and discards settings', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderPage();
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const input = screen.getByLabelText('Text template');
    await user.type(input, '!');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(input).toHaveValue('{{title}}');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Follower alerts');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')).toEqual({
        method: 'PATCH',
        url: `/api/widgets/${W}`,
        body: { name: 'Follower alerts', settings: { textTemplate: '{{title}}', volume: 80 } },
      });
    });
    await waitFor(() => {
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    });
  });

  it('shows problems and makes settings read-only for newer_plugin_version', async () => {
    api(
      detail({
        status: 'broken',
        problems: [
          {
            code: 'newer_plugin_version',
            message:
              'This widget was saved by version 2.0.0 of Alerts, but version 1.0.0 is installed.',
          },
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByText(
        'This widget was saved by version 2.0.0 of Alerts, but version 1.0.0 is installed.',
      ),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('Text template')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Test: Show alert' })).not.toBeInTheDocument();
  });

  it('shows only the problem for a widget whose plugin is missing', async () => {
    api(
      detail({
        status: 'broken',
        typeName: null,
        problems: [
          { code: 'plugin_missing', message: 'The plugin overly.alerts is not installed.' },
        ],
      }),
    );
    renderPage();
    expect(
      await screen.findByText('The plugin overly.alerts is not installed.'),
    ).toBeInTheDocument();
    expect(screen.queryByTitle('Overlay preview')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Text template')).not.toBeInTheDocument();
  });

  it('shows a message when the widget was deleted elsewhere', async () => {
    api('gone');
    renderPage();
    expect(await screen.findByText('This widget no longer exists.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('deletes after confirmation and returns home', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Widget actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Home page')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'DELETE')?.url).toBe(`/api/widgets/${W}`);
  });

  it('turns the widget off from its page', async () => {
    const calls = api();
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('switch', { name: 'Enabled' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ enabled: false });
    });
  });
});
