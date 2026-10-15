import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  Center,
  Group,
  List,
  Loader,
  Menu,
  Modal,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { WidgetDetail, WidgetProblemCode, WidgetTypeInfo } from '@overly/shared';
import { useCallback, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { ApiError } from '../api/client.js';
import {
  useDeleteWidget,
  useDuplicateWidget,
  usePlugins,
  useUpdateWidget,
  useWidget,
} from '../api/hooks.js';
import { OverlayCard } from './OverlayCard.js';
import { SettingsForm } from './SettingsForm.js';
import { TestActions } from './TestActions.js';
import { TypeIcon } from './TypeIcon.js';

/** Problems that leave nothing to show but the problem itself and Delete. */
const ONLY_PROBLEMS = new Set<WidgetProblemCode>([
  'plugin_missing',
  'plugin_broken',
  'type_missing',
  'unreadable',
  'unsupported_version',
]);

function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'widget_not_found';
}

function Gone() {
  return (
    <Center mih="40vh">
      <Stack align="center" gap="xs">
        <Text>This widget no longer exists.</Text>
        <Anchor component={Link} to="/">
          Back to the dashboard
        </Anchor>
      </Stack>
    </Center>
  );
}

function Header({ widget, onDelete }: { widget: WidgetDetail; onDelete: () => void }) {
  const update = useUpdateWidget(widget.id);
  const duplicate = useDuplicateWidget();
  const navigate = useNavigate();
  return (
    <Group justify="space-between" wrap="nowrap">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
        <TypeIcon url={widget.iconUrl} size={32} />
        <div style={{ minWidth: 0 }}>
          <Title order={2} size="h3" style={{ overflowWrap: 'anywhere' }}>
            {widget.name}
          </Title>
          {widget.typeName !== null && (
            <Text size="sm" c="dimmed">
              {widget.typeName}
            </Text>
          )}
        </div>
      </Group>
      <Group gap="sm" wrap="nowrap">
        <Switch
          label="Enabled"
          checked={widget.enabled}
          disabled={widget.status === 'broken' || update.isPending}
          onChange={(event) => {
            update.mutate({ enabled: event.currentTarget.checked });
          }}
        />
        <Menu position="bottom-end">
          <Menu.Target>
            <ActionIcon variant="subtle" aria-label="Widget actions">
              ⋯
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item
              disabled={widget.status === 'broken' && widget.typeName === null}
              onClick={() => {
                duplicate.mutate(widget.id, {
                  onSuccess: (copy) => {
                    void navigate(`/widgets/${copy.id}`);
                  },
                });
              }}
            >
              Duplicate
            </Menu.Item>
            <Menu.Item color="red" onClick={onDelete}>
              Delete
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Group>
  );
}

function Content({
  widget,
  type,
  onGone,
}: {
  widget: WidgetDetail;
  type: WidgetTypeInfo | undefined;
  onGone: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const onDraft = useCallback((next: Record<string, unknown> | null) => {
    setDraft(next);
  }, []);
  const codes = widget.problems.map((problem) => problem.code);
  if (type === undefined || codes.some((code) => ONLY_PROBLEMS.has(code))) return null;
  const broken = widget.status === 'broken';
  const active = widget.enabled && !broken;
  return (
    <Stack gap="md">
      {widget.overlay !== null && widget.overlayUrl !== null && (
        <OverlayCard widget={widget} size={widget.overlay} active={active} draft={draft} />
      )}
      {!broken && type.actions.length > 0 && (
        <TestActions widget={widget} actions={type.actions} onGone={onGone} />
      )}
      <SettingsForm
        widget={widget}
        type={type}
        readOnly={codes.includes('newer_plugin_version')}
        onDraft={onDraft}
        onGone={onGone}
      />
    </Stack>
  );
}

/**
 * One widget: header, problems, overlay URL and preview, test buttons and settings. Shows
 * "This widget no longer exists." when the server says so, also after a failed save or test.
 */
export function WidgetPage({ widgetId }: { widgetId: string }) {
  const widget = useWidget(widgetId);
  const plugins = usePlugins();
  const remove = useDeleteWidget();
  const navigate = useNavigate();
  const [gone, setGone] = useState(false);
  const [confirming, confirm] = useDisclosure(false);
  const onGone = useCallback(() => {
    setGone(true);
  }, []);

  if (gone || isGone(widget.error)) return <Gone />;
  if (widget.isPending) {
    return (
      <Center mih="40vh">
        <Loader aria-label="Loading the widget" />
      </Center>
    );
  }
  if (widget.data === undefined) {
    return (
      <Alert color="red" title="The widget could not be loaded">
        {widget.error instanceof Error ? widget.error.message : null}
      </Alert>
    );
  }

  const data = widget.data;
  const type = plugins.data?.plugins
    .flatMap((plugin) => plugin.widgetTypes)
    .find((candidate) => candidate.type === data.type);

  return (
    <Stack gap="md" maw={960}>
      <Header widget={data} onDelete={confirm.open} />
      {data.problems.length > 0 && (
        <Alert color="red" title="This widget is broken">
          <List size="sm">
            {data.problems.map((problem) => (
              <List.Item key={problem.code}>{problem.message}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {plugins.isPending ? (
        <Loader aria-label="Loading widget types" />
      ) : (
        <Content key={data.id} widget={data} type={type} onGone={onGone} />
      )}
      <Modal opened={confirming} onClose={confirm.close} title="Delete this widget?">
        <Stack>
          <Text>
            {data.name} and its settings will be deleted. Its URL will stop working in OBS.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={confirm.close}>
              Cancel
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(data.id, {
                  onSuccess: () => {
                    confirm.close();
                    void navigate('/');
                  },
                });
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

/** `/widgets/:widgetId`. The key resets the page's state when another widget opens. */
export function WidgetPageRoute() {
  const { widgetId = '' } = useParams();
  return <WidgetPage key={widgetId} widgetId={widgetId} />;
}
