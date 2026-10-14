import { Badge } from '@mantine/core';

import { type ConnectionStatus, useConnectionStatus } from '../connection/ServerConnection.js';

const LOOK: Record<ConnectionStatus, { label: string; color: string }> = {
  connecting: { label: 'Connecting…', color: 'gray' },
  connected: { label: 'Connected', color: 'green' },
  reconnecting: { label: 'Reconnecting…', color: 'yellow' },
};

export function ConnectionBadge() {
  const { label, color } = LOOK[useConnectionStatus()];
  return (
    <Badge variant="dot" color={color}>
      {label}
    </Badge>
  );
}
