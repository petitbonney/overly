import { Alert, List, Stack, Text } from '@mantine/core';

import { usePlugins } from '../api/hooks.js';

/** Plugins that failed to load, with their errors. Renders nothing when all are fine. */
export function BrokenPlugins() {
  const plugins = usePlugins();
  const broken = plugins.data?.plugins.filter((plugin) => plugin.status === 'broken') ?? [];
  if (broken.length === 0) return null;
  return (
    <Alert
      color="red"
      title={
        broken.length === 1
          ? 'A plugin could not be loaded'
          : `${String(broken.length)} plugins could not be loaded`
      }
    >
      <Stack gap="xs">
        {broken.map((plugin) => (
          <div key={plugin.folder}>
            <Text size="sm" fw={600}>
              {plugin.name}
            </Text>
            {plugin.name !== plugin.folder && (
              <Text size="xs" c="dimmed">
                Folder: {plugin.folder}
              </Text>
            )}
            <List size="sm">
              {plugin.errors.map((error) => (
                <List.Item key={error}>{error}</List.Item>
              ))}
            </List>
          </div>
        ))}
      </Stack>
    </Alert>
  );
}
