import { Box, Button, Center, Group, Stack, Text } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import type { WidgetDetail } from '@overly/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

const DRAFT_DEBOUNCE_MS = 150;

/** A checkerboard, so transparent parts of the overlay show as transparent. */
const CHECKERBOARD =
  'repeating-conic-gradient(var(--mantine-color-default-border) 0% 25%, transparent 0% 50%) 50% / 20px 20px';

/**
 * The overlay in a sandboxed iframe (ADR 0014) at its recommended size, scaled to fit. Sound
 * is muted until unmuted. Unsaved settings (`draft`) are posted to it so it follows the form.
 */
export function OverlayPreview({
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
  const [muted, setMuted] = useState(true);
  const [reloads, setReloads] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);
  const { ref: box, width } = useElementSize();
  const scale = width > 0 ? width / size.width : 1 / 4;
  const src = `/o/${encodeURIComponent(widget.id)}?preview=1${muted ? '' : '&muted=0'}`;

  const postDraft = useCallback(() => {
    // The sandboxed page has an opaque origin, so '*' is the only possible target origin.
    frame.current?.contentWindow?.postMessage(
      { source: 'overly-dashboard', type: 'draft-settings', settings: draft },
      '*',
    );
  }, [draft]);

  useEffect(() => {
    const timer = setTimeout(postDraft, DRAFT_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [postDraft]);

  return (
    <Stack gap="xs">
      <Box
        ref={box}
        pos="relative"
        w="100%"
        h={size.height * scale}
        style={{ overflow: 'hidden', background: CHECKERBOARD, borderRadius: 8 }}
      >
        <iframe
          key={`${String(reloads)}-${String(muted)}`}
          ref={frame}
          src={src}
          title="Overlay preview"
          sandbox="allow-scripts"
          allow="autoplay"
          width={size.width}
          height={size.height}
          onLoad={postDraft}
          style={{
            border: 0,
            position: 'absolute',
            top: 0,
            left: 0,
            transform: `scale(${String(scale)})`,
            transformOrigin: '0 0',
          }}
        />
        {!active && (
          <Center pos="absolute" inset={0} bg="rgb(0 0 0 / 50%)">
            <Text c="white" fw={600}>
              Disabled
            </Text>
          </Center>
        )}
      </Box>
      <Group gap="xs">
        <Button
          variant="default"
          size="xs"
          onClick={() => {
            setMuted((value) => !value);
          }}
        >
          {muted ? 'Unmute' : 'Mute'}
        </Button>
        <Button
          variant="default"
          size="xs"
          onClick={() => {
            setReloads((value) => value + 1);
          }}
        >
          Reload
        </Button>
      </Group>
    </Stack>
  );
}
