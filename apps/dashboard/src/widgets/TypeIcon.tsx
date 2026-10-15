import { Box } from '@mantine/core';

/** A widget type's icon from its plugin, or an empty square when it has none. */
export function TypeIcon({ url, size = 18 }: { url: string | null; size?: number }) {
  if (url === null) {
    return <Box w={size} h={size} bg="var(--mantine-color-default-border)" />;
  }
  return <img src={url} alt="" width={size} height={size} />;
}
