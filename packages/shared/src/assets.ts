import { z } from 'zod';

import { AssetIdSchema } from './ids.js';
import { type AssetKind, AssetKindSchema } from './schema/subset.js';

/** Files the asset library accepts, by lowercase extension. */
export const ASSET_EXTENSIONS: Readonly<Record<string, { kind: AssetKind; mime: string }>> = {
  '.png': { kind: 'image', mime: 'image/png' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.avif': { kind: 'image', mime: 'image/avif' },
  '.svg': { kind: 'image', mime: 'image/svg+xml' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.opus': { kind: 'audio', mime: 'audio/ogg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.woff2': { kind: 'font', mime: 'font/woff2' },
  '.woff': { kind: 'font', mime: 'font/woff' },
  '.ttf': { kind: 'font', mime: 'font/ttf' },
  '.otf': { kind: 'font', mime: 'font/otf' },
};

/** 100 MB per file. */
export const MAX_ASSET_BYTES = 104_857_600;

export const AssetSchema = z.object({
  id: AssetIdSchema,
  /** The uploaded file's name, for display. */
  name: z.string().min(1).max(200),
  kind: AssetKindSchema,
  mime: z.string(),
  size: z.int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** The type of an uploaded file, from the extension of its name. */
export function assetTypeForName(
  name: string,
): { ext: string; kind: AssetKind; mime: string } | undefined {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return undefined;
  const ext = name.slice(dot).toLowerCase();
  if (!Object.hasOwn(ASSET_EXTENSIONS, ext)) return undefined;
  const type = ASSET_EXTENSIONS[ext];
  return type === undefined ? undefined : { ext, ...type };
}

/** Extensions for an `<input accept>` that only offers files of these kinds. */
export function acceptForKinds(kinds: readonly AssetKind[]): string {
  return Object.entries(ASSET_EXTENSIONS)
    .filter(([, type]) => kinds.includes(type.kind))
    .map(([ext]) => ext)
    .join(',');
}
