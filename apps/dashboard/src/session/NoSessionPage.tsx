import { Stack, Text, Title } from '@mantine/core';

export function NoSessionPage() {
  return (
    <Stack align="center" justify="center" mih="100vh" gap="xs" p="md" ta="center">
      <Title order={1}>No active session</Title>
      <Text c="dimmed">Open the dashboard from the Overly tray icon.</Text>
    </Stack>
  );
}
