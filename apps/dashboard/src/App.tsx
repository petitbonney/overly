import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router';

import { AppLayout } from './layout/AppLayout.js';
import { HomePage } from './pages/HomePage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { theme } from './theme.js';

// The light/dark choice is a per-browser preference, so local storage is the right place for it.
const colorSchemeManager = localStorageColorSchemeManager({ key: 'overly-color-scheme' });

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme="auto"
      colorSchemeManager={colorSchemeManager}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MantineProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

export function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
