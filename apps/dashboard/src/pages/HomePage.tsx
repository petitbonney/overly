import { Stack, Text, Title } from '@mantine/core';

import { BrokenPlugins } from '../widgets/BrokenPlugins.js';

export function HomePage() {
  return (
    <Stack align="center" justify="center" mih="60vh" gap="md" ta="center">
      <Title order={2}>Welcome to Overly</Title>
      <Text c="dimmed" maw={480}>
        Add a widget with the + button next to Widgets, then copy its URL into OBS.
      </Text>
      <BrokenPlugins />
    </Stack>
  );
}
