import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { ActionInfo, WidgetDetail } from '@overly/shared';

import { ApiError } from '../api/client.js';
import { useRunAction } from '../api/hooks.js';
import { useActionNotifications } from './useActionNotifications.js';

/** One button per action, running it with the sample parameters from the manifest. */
export function TestActions({
  widget,
  actions,
  onGone,
}: {
  widget: WidgetDetail;
  actions: readonly ActionInfo[];
  onGone: () => void;
}) {
  const run = useRunAction(widget.id);
  const notify = useActionNotifications();
  const { pending } = widget.runtime.queue;

  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3} size="h5">
            Test
          </Title>
          {pending > 0 && (
            <Text size="sm" c="dimmed">
              {pending} waiting
            </Text>
          )}
        </Group>
        {!widget.enabled && (
          <Text size="sm" c="dimmed">
            Turn the widget on to test it.
          </Text>
        )}
        <Group gap="xs">
          {actions.map((action) => (
            <Button
              key={action.name}
              variant="light"
              disabled={!widget.enabled}
              onClick={() => {
                run.mutate(
                  { action: action.name, body: { params: action.sample } },
                  {
                    onSuccess: ({ actionId }) => {
                      notify.started(actionId, action.title);
                    },
                    onError: (error) => {
                      if (error instanceof ApiError && error.code === 'widget_not_found') onGone();
                      else notify.refused(action.title, error);
                    },
                  },
                );
              }}
            >
              Test: {action.title}
            </Button>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}
