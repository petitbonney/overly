import { Anchor, Stack, Title } from '@mantine/core';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <Stack align="center" justify="center" mih="60vh" gap="xs">
      <Title order={1}>Page not found</Title>
      <Anchor component={Link} to="/">
        Back to the dashboard
      </Anchor>
    </Stack>
  );
}
