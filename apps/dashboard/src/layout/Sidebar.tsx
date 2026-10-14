import { ActionIcon, Group, Stack, Text, Title, Tooltip } from '@mantine/core';

function Section({ title, addLabel, empty }: { title: string; addLabel: string; empty: string }) {
  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Title order={2} size="h5">
          {title}
        </Title>
        <Tooltip label="Coming in a later version">
          {/* A disabled button fires no mouse events: the wrapper shows the tooltip. */}
          <span>
            <ActionIcon variant="subtle" aria-label={addLabel} disabled>
              +
            </ActionIcon>
          </span>
        </Tooltip>
      </Group>
      <Text size="sm" c="dimmed">
        {empty}
      </Text>
    </Stack>
  );
}

export function Sidebar() {
  return (
    <Stack gap="xl">
      <Section title="Widgets" addLabel="Add widget" empty="No widgets yet." />
      <Section title="Pipelines" addLabel="Add pipeline" empty="No pipelines yet." />
    </Stack>
  );
}
