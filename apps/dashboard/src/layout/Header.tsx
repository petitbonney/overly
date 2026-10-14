import { Badge, Burger, Group, Title } from '@mantine/core';

import { ThemeToggle } from './ThemeToggle.js';

export function Header({
  navbarOpened,
  onToggleNavbar,
}: {
  navbarOpened: boolean;
  onToggleNavbar: () => void;
}) {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap">
        <Burger
          opened={navbarOpened}
          onClick={onToggleNavbar}
          hiddenFrom="sm"
          size="sm"
          aria-label="Toggle navigation"
        />
        <Title order={1} size="h3">
          Overly
        </Title>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <Badge variant="light" color="gray">
          Twitch: not connected
        </Badge>
        <ThemeToggle />
      </Group>
    </Group>
  );
}
