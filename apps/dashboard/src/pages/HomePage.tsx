import { Stack, Text, Title } from '@mantine/core';

export function HomePage() {
  return (
    <Stack align="center" justify="center" mih="60vh" gap="xs" ta="center">
      <Title order={2}>Welcome to Overly</Title>
      <Text c="dimmed" maw={480}>
        Widgets and pipelines arrive in the next versions. For now, this page shows that the server
        is running.
      </Text>
    </Stack>
  );
}
