import type { WidgetSummary } from '@overly/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ApiCall, mockApi } from '../test/api.js';
import { brokenPlugin, detail, okPlugins, summary } from '../test/fixtures.js';
import { renderWithProviders } from '../test/render.js';
import { BrokenPlugins } from './BrokenPlugins.js';
import { WidgetList } from './WidgetList.js';

function Location() {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function api(widgets: WidgetSummary[], plugins = okPlugins): ApiCall[] {
  return mockApi(({ method, url, body }) => {
    if (method === 'GET' && url === '/api/widgets') return { body: { widgets } };
    if (method === 'GET' && url === '/api/plugins') return { body: { plugins } };
    if (method === 'PATCH') return { body: detail({ ...(body as object) }) };
    if (method === 'POST' && url === '/api/widgets') {
      return { status: 201, body: detail({ id: 'newwidget123', name: 'Text banner' }) };
    }
    return undefined;
  });
}

function renderList() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="*" element={<WidgetList />} />
      </Routes>
      <Location />
    </>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WidgetList', () => {
  it('lists widgets with icons and filters them by search', async () => {
    api([
      summary(),
      summary({
        id: 'bannerbanner',
        name: 'Lower third',
        type: 'overly.text-banner:banner',
        typeName: 'Text banner',
      }),
    ]);
    const user = userEvent.setup();
    renderList();
    const link = await screen.findByRole('link', { name: /Alerts/ });
    expect(link).toHaveAttribute('href', '/widgets/abcdefghij12');
    expect(link.querySelector('img')).toHaveAttribute(
      'src',
      '/plugins/overly.alerts/icons/alerts.svg',
    );
    await user.type(screen.getByRole('textbox', { name: 'Search widgets' }), 'banner');
    expect(screen.queryByRole('link', { name: /Alerts/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lower third/ })).toBeInTheDocument();
  });

  it('toggles a widget from the list', async () => {
    const calls = api([summary()]);
    const user = userEvent.setup();
    renderList();
    await user.click(await screen.findByRole('switch', { name: 'Enable Alerts' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')).toEqual({
        method: 'PATCH',
        url: '/api/widgets/abcdefghij12',
        body: { enabled: false },
      });
    });
  });

  it('shows a Broken badge with the first problem', async () => {
    api([
      summary({
        status: 'broken',
        problems: [
          { code: 'plugin_missing', message: 'The plugin overly.alerts is not installed.' },
        ],
      }),
    ]);
    const user = userEvent.setup();
    renderList();
    const badge = await screen.findByText('Broken');
    expect(screen.getByRole('switch', { name: 'Enable Alerts' })).toBeDisabled();
    await user.hover(badge);
    expect(
      await screen.findByText('The plugin overly.alerts is not installed.'),
    ).toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    api([]);
    renderList();
    expect(await screen.findByText('No widgets yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add widget' })).toBeEnabled();
  });

  it('creates a widget from the library and opens its page', async () => {
    const calls = api([]);
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    await user.click(await screen.findByRole('button', { name: /Add Text banner/ }));
    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/widgets/newwidget123');
    });
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      type: 'overly.text-banner:banner',
    });
  });

  it('filters the library by search', async () => {
    api([]);
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    await screen.findByRole('button', { name: /Add Alerts/ });
    await user.type(screen.getByRole('textbox', { name: 'Search widget types' }), 'sound');
    expect(screen.getByRole('button', { name: /Add Alerts/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add Text banner/ })).not.toBeInTheDocument();
  });

  it('lists broken plugins in the library', async () => {
    api([], [...okPlugins, brokenPlugin]);
    const user = userEvent.setup();
    renderList();
    await user.click(screen.getByRole('button', { name: 'Add widget' }));
    expect(await screen.findByText('A plugin could not be loaded')).toBeInTheDocument();
  });
});

describe('BrokenPlugins', () => {
  it('lists broken plugins with their errors', async () => {
    api([], [...okPlugins, brokenPlugin]);
    renderWithProviders(<BrokenPlugins />);
    expect(await screen.findByText('A plugin could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('odd-plugin')).toBeInTheDocument();
    expect(
      screen.getByText('overly.plugin.json is not valid JSON: Unexpected end of JSON input'),
    ).toBeInTheDocument();
  });

  it('renders nothing when every plugin is ok', async () => {
    const calls = api([]);
    renderWithProviders(<BrokenPlugins />);
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
