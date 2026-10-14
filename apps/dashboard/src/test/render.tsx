import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { AppProviders } from '../App.js';

/** Renders `ui` with the app's providers and an in-memory router at `route`. */
export function renderWithProviders(
  ui: ReactElement,
  options: { route?: string } = {},
): RenderResult {
  return render(
    <AppProviders>
      <MemoryRouter initialEntries={[options.route ?? '/']}>{ui}</MemoryRouter>
    </AppProviders>,
  );
}
