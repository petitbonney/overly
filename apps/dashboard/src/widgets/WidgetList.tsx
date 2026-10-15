import {
  ActionIcon,
  Badge,
  Group,
  Loader,
  NavLink,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { WidgetSummary } from '@overly/shared';
import { useState } from 'react';
import { Link, useLocation } from 'react-router';

import { useUpdateWidget, useWidgets } from '../api/hooks.js';
import { TypeIcon } from './TypeIcon.js';
import { WidgetLibraryModal } from './WidgetLibraryModal.js';

function WidgetRow({ widget, active }: { widget: WidgetSummary; active: boolean }) {
  const update = useUpdateWidget(widget.id);
  const broken = widget.status === 'broken';
  return (
    <Group gap={4} wrap="nowrap">
      <NavLink
        component={Link}
        to={`/widgets/${widget.id}`}
        active={active}
        label={widget.name}
        leftSection={<TypeIcon url={widget.iconUrl} />}
        rightSection={
          broken ? (
            <Tooltip
              label={widget.problems[0]?.message ?? 'This widget is broken'}
              multiline
              w={260}
            >
              <Badge color="red" size="xs">
                Broken
              </Badge>
            </Tooltip>
          ) : undefined
        }
        style={{ flex: 1, minWidth: 0 }}
      />
      <Switch
        size="xs"
        aria-label={`Enable ${widget.name}`}
        checked={widget.enabled}
        disabled={broken || update.isPending}
        onChange={(event) => {
          update.mutate({ enabled: event.currentTarget.checked });
        }}
      />
    </Group>
  );
}

/** The Widgets section of the sidebar: search, one row per widget, and the `+` button. */
export function WidgetList() {
  const widgets = useWidgets();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [libraryOpened, library] = useDisclosure(false);

  const list = widgets.data?.widgets ?? [];
  const query = search.trim().toLowerCase();
  const filtered = list.filter((widget) =>
    [widget.name, widget.typeName ?? ''].some((text) => text.toLowerCase().includes(query)),
  );

  return (
    <Stack gap={4}>
      <Group justify="space-between">
        <Title order={2} size="h5">
          Widgets
        </Title>
        <ActionIcon variant="subtle" aria-label="Add widget" onClick={library.open}>
          +
        </ActionIcon>
      </Group>
      {list.length > 0 && (
        <TextInput
          size="xs"
          aria-label="Search widgets"
          placeholder="Search widgets"
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
          }}
        />
      )}
      {widgets.isPending && <Loader size="xs" aria-label="Loading widgets" />}
      {!widgets.isPending && list.length === 0 && (
        <Text size="sm" c="dimmed">
          No widgets yet.
        </Text>
      )}
      {filtered.map((widget) => (
        <WidgetRow
          key={widget.id}
          widget={widget}
          active={location.pathname === `/widgets/${widget.id}`}
        />
      ))}
      {list.length > 0 && filtered.length === 0 && (
        <Text size="sm" c="dimmed">
          No widget matches “{search}”.
        </Text>
      )}
      <WidgetLibraryModal opened={libraryOpened} onClose={library.close} />
    </Stack>
  );
}
