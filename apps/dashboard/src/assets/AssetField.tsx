import { Button, Group, Input, Loader, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { AssetKind } from '@overly/shared';
import type { ReactNode } from 'react';

import { useAssets } from '../api/hooks.js';
import { AssetModal, AssetThumbnail } from './AssetModal.js';

/** A settings field holding an asset ID ("" for none), chosen from the asset library. */
export function AssetField({
  label,
  description,
  error,
  value,
  onChange,
  accept,
  disabled = false,
}: {
  label: string;
  description?: ReactNode;
  error?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  accept: readonly AssetKind[];
  disabled?: boolean;
}) {
  const [opened, { open, close }] = useDisclosure(false);
  const assets = useAssets(accept);
  const selected =
    value === '' ? undefined : assets.data?.assets.find((asset) => asset.id === value);

  let current: ReactNode;
  if (value === '') {
    current = (
      <Text size="sm" c="dimmed">
        None
      </Text>
    );
  } else if (selected !== undefined) {
    current = (
      <Group gap="xs" wrap="nowrap">
        <AssetThumbnail asset={selected} size={40} />
        <Text size="sm" truncate maw={220}>
          {selected.name}
        </Text>
      </Group>
    );
  } else if (assets.isPending) {
    current = <Loader size="xs" aria-label="Loading files" />;
  } else {
    current = (
      <Text size="sm" c="red">
        Missing asset
      </Text>
    );
  }

  return (
    <Input.Wrapper label={label} description={description} error={error}>
      <Group gap="sm" mt={4}>
        {current}
        <Button variant="default" size="xs" onClick={open} disabled={disabled}>
          Choose…
        </Button>
        {value !== '' && (
          <Button
            variant="subtle"
            size="xs"
            disabled={disabled}
            onClick={() => {
              onChange('');
            }}
          >
            Clear
          </Button>
        )}
      </Group>
      <AssetModal
        opened={opened}
        onClose={close}
        accept={accept}
        onSelect={(asset) => {
          onChange(asset.id);
          close();
        }}
      />
    </Input.Wrapper>
  );
}
