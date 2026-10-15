import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Center,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  SimpleGrid,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { acceptForKinds, type Asset, type AssetKind } from '@overly/shared';
import { useState } from 'react';

import { useAssets, useDeleteAsset, useUploadAsset } from '../api/hooks.js';

const KIND_LABELS: Record<AssetKind, string> = {
  image: 'Image',
  audio: 'Sound',
  video: 'Video',
  font: 'Font',
};

export function assetUrl(asset: Asset): string {
  return `/assets/${encodeURIComponent(asset.id)}`;
}

/** A thumbnail for images, the kind for other files. */
export function AssetThumbnail({ asset, size }: { asset: Asset; size: number }) {
  if (asset.kind === 'image') {
    return <Image src={assetUrl(asset)} alt="" h={size} w={size} fit="contain" />;
  }
  return (
    <Center h={size} w={size} bg="var(--mantine-color-default-hover)">
      <Text size="xs" c="dimmed">
        {KIND_LABELS[asset.kind]}
      </Text>
    </Center>
  );
}

/** The asset library, filtered to the kinds a field accepts: pick, upload or delete files. */
export function AssetModal({
  opened,
  onClose,
  accept,
  onSelect,
}: {
  opened: boolean;
  onClose: () => void;
  accept: readonly AssetKind[];
  onSelect: (asset: Asset) => void;
}) {
  const assets = useAssets(accept);
  const upload = useUploadAsset();
  const remove = useDeleteAsset();
  const [confirming, setConfirming] = useState<Asset | undefined>();

  const handleUpload = async (file: File | null): Promise<void> => {
    if (file === null) return;
    const asset = await upload.mutateAsync(file).catch(() => undefined);
    if (asset !== undefined) onSelect(asset);
  };

  const list = assets.data?.assets ?? [];
  return (
    <>
      <Modal opened={opened} onClose={onClose} title="Choose a file" size="lg">
        <Stack gap="md">
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {accept.map((kind) => KIND_LABELS[kind]).join(', ')} files from your library
            </Text>
            <FileButton
              accept={acceptForKinds(accept)}
              onChange={(file) => {
                void handleUpload(file);
              }}
            >
              {(props) => (
                <Button {...props} loading={upload.isPending}>
                  Upload
                </Button>
              )}
            </FileButton>
          </Group>
          {upload.error !== null && (
            <Alert color="red" title="Upload failed">
              {upload.error.message}
            </Alert>
          )}
          {assets.isPending && <Loader aria-label="Loading files" />}
          {!assets.isPending && list.length === 0 && (
            <Text c="dimmed">No files yet. Upload one.</Text>
          )}
          <SimpleGrid cols={{ base: 2, sm: 3 }}>
            {list.map((asset) => (
              <Card key={asset.id} withBorder padding="xs">
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <UnstyledButton
                    aria-label={`Select ${asset.name}`}
                    onClick={() => {
                      onSelect(asset);
                    }}
                    style={{ minWidth: 0, flex: 1 }}
                  >
                    <AssetThumbnail asset={asset} size={72} />
                    <Text size="sm" truncate mt={4}>
                      {asset.name}
                    </Text>
                  </UnstyledButton>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    aria-label={`Delete ${asset.name}`}
                    onClick={() => {
                      setConfirming(asset);
                    }}
                  >
                    ×
                  </ActionIcon>
                </Group>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      </Modal>
      <Modal
        opened={confirming !== undefined}
        onClose={() => {
          setConfirming(undefined);
        }}
        title="Delete this file?"
      >
        <Stack>
          <Text>
            {confirming?.name} will be deleted. Widgets that use it will show nothing in its place.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setConfirming(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={remove.isPending}
              onClick={() => {
                if (confirming === undefined) return;
                remove.mutate(confirming.id, {
                  onSettled: () => {
                    setConfirming(undefined);
                  },
                });
              }}
            >
              Delete
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
