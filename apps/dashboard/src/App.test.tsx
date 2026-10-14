import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AppRoutes } from './App.js';
import { renderWithProviders } from './test/render.js';

describe('dashboard layout', () => {
  it('shows the Widgets and Pipelines sections with disabled add buttons', () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getByRole('heading', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pipelines' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add widget' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add pipeline' })).toBeDisabled();
    expect(screen.getByText('No widgets yet.')).toBeInTheDocument();
    expect(screen.getByText('No pipelines yet.')).toBeInTheDocument();
  });

  it('shows the empty state in the main pane', () => {
    renderWithProviders(<AppRoutes />);
    expect(screen.getByRole('heading', { name: 'Welcome to Overly' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Widgets and pipelines arrive in the next versions. For now, this page shows that the server is running.',
      ),
    ).toBeInTheDocument();
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
