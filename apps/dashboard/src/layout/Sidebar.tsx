import { ActionIcon, Group, Stack, Text, Title, Tooltip } from '@mantine/core';

import { WidgetList } from '../widgets/WidgetList.js';

function PipelinesSection() {
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Title order={2} size="h5">
          Pipelines
        </Title>
        <Tooltip label="Coming in a later version">
          {/* A disabled button fires no mouse events: the wrapper shows the tooltip. */}
          <span>
            <ActionIcon variant="subtle" aria-label="Add pipeline" disabled>
              +
            </ActionIcon>
          </span>
        </Tooltip>
      </Group>
      <Text size="sm" c="dimmed">
        No pipelines yet.
      </Text>
    </Stack>
  );
}

export function Sidebar() {
  return (
    <Stack gap="xl">
      <WidgetList />
      <PipelinesSection />
    </Stack>
  );
}
