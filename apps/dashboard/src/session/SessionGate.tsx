import { Button, Center, Loader, Stack, Text } from '@mantine/core';
import { SessionResponseSchema } from '@overly/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError, apiGet } from '../api/client.js';
import { NoSessionPage } from './NoSessionPage.js';

function isNoSession(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/** Shows `children` only with a valid dashboard session (the cookie set from the tray's link). */
export function SessionGate({
  children,
  retryDelayMs = 1000,
}: {
  children: ReactNode;
  retryDelayMs?: number;
}) {
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => apiGet('/api/session', SessionResponseSchema),
    retry: (failures, error) => !isNoSession(error) && failures < 2,
    retryDelay: retryDelayMs,
  });

  if (session.isPending) {
    return (
      <Center mih="100vh">
        <Loader aria-label="Loading" />
      </Center>
    );
  }
  if (session.isError && isNoSession(session.error)) return <NoSessionPage />;
  // A failed background check (the server is restarting) keeps the dashboard: the connection
  // badge shows "Reconnecting…". The error screen is only for a first check that never succeeded.
  if (session.data === undefined) {
    return (
      <Stack align="center" justify="center" mih="100vh" gap="sm">
        <Text>Can&apos;t reach the Overly server.</Text>
        <Button
          variant="default"
          loading={session.isFetching}
          onClick={() => {
            void session.refetch();
          }}
        >
          Retry
        </Button>
      </Stack>
    );
  }
  return children;
}
