import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Outlet } from 'react-router';

import { Header } from './Header.js';
import { Sidebar } from './Sidebar.js';

export function AppLayout() {
  const [navbarOpened, { toggle }] = useDisclosure();
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !navbarOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Header navbarOpened={navbarOpened} onToggleNavbar={toggle} />
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <Sidebar />
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
