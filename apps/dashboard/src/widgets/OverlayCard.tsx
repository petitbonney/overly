import { Button, Card, CopyButton, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import type { WidgetDetail } from '@overly/shared';

import { OverlayPreview } from './OverlayPreview.js';

function connectionStatus(live: number): string {
  if (live === 0) return 'Not in OBS yet';
  return live === 1 ? '1 overlay connected' : `${String(live)} overlays connected`;
}

/**
 * The overlay URL to paste into OBS (from the API, so it names the server's port even when the
 * dashboard runs elsewhere), its recommended size, how many OBS overlays are connected, and the
 * preview.
 */
export function OverlayCard({
  widget,
  size,
  active,
  draft,
}: {
  widget: WidgetDetail;
  size: { width: number; height: number };
  active: boolean;
  draft: Record<string, unknown> | null;
}) {
  const url = widget.overlayUrl ?? '';
  return (
    <Card withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3} size="h5">
            Overlay
          </Title>
          <Text size="sm" c="dimmed">
            {connectionStatus(widget.runtime.overlays.live)}
          </Text>
        </Group>
        <Group gap="xs" wrap="nowrap" align="flex-end">
          <TextInput
            label="Browser Source URL"
            value={url}
            readOnly
            style={{ flex: 1 }}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <CopyButton value={url}>
            {({ copied, copy }) => (
              <Button
                variant={copied ? 'light' : 'filled'}
                onClick={copy}
                aria-label="Copy URL"
                w={110}
              >
                {copied ? 'Copied' : 'Copy URL'}
              </Button>
            )}
          </CopyButton>
        </Group>
        <Text size="sm" c="dimmed">
          Recommended Browser Source size: {size.width} × {size.height}
        </Text>
        <OverlayPreview widget={widget} size={size} active={active} draft={draft} />
      </Stack>
    </Card>
  );
}
