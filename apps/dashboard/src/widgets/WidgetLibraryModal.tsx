import {
  Alert,
  Card,
  Group,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { useState } from 'react';
import { useNavigate } from 'react-router';

import { useCreateWidget, usePlugins } from '../api/hooks.js';
import { BrokenPlugins } from './BrokenPlugins.js';
import { TypeIcon } from './TypeIcon.js';

/** The widget types of every ok plugin. Picking one creates a widget and opens its page. */
export function WidgetLibraryModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const plugins = usePlugins();
  const create = useCreateWidget();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const types = (plugins.data?.plugins ?? [])
    .filter((plugin) => plugin.status === 'ok')
    .flatMap((plugin) => plugin.widgetTypes.map((type) => ({ ...type, pluginName: plugin.name })))
    .filter((type) =>
      [type.name, type.description ?? '', type.pluginName].some((text) =>
        text.toLowerCase().includes(query),
      ),
    );

  return (
    <Modal opened={opened} onClose={onClose} title="Add a widget" size="xl">
      <Stack gap="md">
        <TextInput
          aria-label="Search widget types"
          placeholder="Search widget types"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
          }}
          data-autofocus
        />
        {plugins.isPending && <Loader aria-label="Loading widget types" />}
        {create.error !== null && (
          <Alert color="red" title="The widget could not be created">
            {create.error.message}
          </Alert>
        )}
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          {types.map((type) => (
            <UnstyledButton
              key={type.type}
              aria-label={`Add ${type.name}`}
              disabled={create.isPending}
              onClick={() => {
                create.mutate(
                  { type: type.type },
                  {
                    onSuccess: (widget) => {
                      onClose();
                      void navigate(`/widgets/${widget.id}`);
                    },
                  },
                );
              }}
            >
              <Card withBorder h="100%">
                <Group gap="sm" wrap="nowrap" mb="xs">
                  <TypeIcon url={type.iconUrl} size={28} />
                  <Text fw={600}>{type.name}</Text>
                </Group>
                {type.description !== undefined && (
                  <Text size="sm" c="dimmed">
                    {type.description}
                  </Text>
                )}
                <Text size="xs" c="dimmed" mt="xs">
                  {type.pluginName}
                </Text>
              </Card>
            </UnstyledButton>
          ))}
        </SimpleGrid>
        {!plugins.isPending && types.length === 0 && (
          <Text c="dimmed">No widget type matches “{search}”.</Text>
        )}
        <BrokenPlugins />
      </Stack>
    </Modal>
  );
}
