import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppRoutes } from './App.js';
import { mockApi } from './test/api.js';
import { brokenPlugin, okPlugins } from './test/fixtures.js';
import { renderWithProviders } from './test/render.js';

let plugins = okPlugins;

beforeEach(() => {
  plugins = okPlugins;
  mockApi(({ url }) => {
    if (url === '/api/widgets') return { body: { widgets: [] } };
    if (url === '/api/plugins') return { body: { plugins } };
    return undefined;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard layout', () => {
  it('shows the Widgets and Pipelines sections', async () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pipelines' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add widget' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add pipeline' })).toBeDisabled();
    expect(await screen.findByText('No widgets yet.')).toBeInTheDocument();
    expect(screen.getByText('No pipelines yet.')).toBeInTheDocument();
  });

  it('shows the empty state in the main pane', () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getByRole('heading', { name: 'Welcome to Overly' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Add a widget with the + button next to Widgets, then copy its URL into OBS.',
      ),
    ).toBeInTheDocument();
  });

  it('lists broken plugins on the home page', async () => {
    plugins = [...okPlugins, brokenPlugin];
    renderWithProviders(<AppRoutes />);
    expect(await screen.findByText('A plugin could not be loaded')).toBeInTheDocument();
  });

  it('shows the Twitch placeholder', () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getByText('Twitch: not connected')).toBeInTheDocument();
  });

  it('switches to the dark theme', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppRoutes />);
    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Dark' }));
    expect(document.documentElement).toHaveAttribute('data-mantine-color-scheme', 'dark');
  });

  it('shows a not-found page for unknown routes', () => {
    renderWithProviders(<AppRoutes />, { route: '/nope' });
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the dashboard' })).toHaveAttribute(
      'href',
      '/',
    );
  });
});
