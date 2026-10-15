import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { MANIFEST_FILE, type PluginManifestSchema } from '@overly/shared';
import type { z } from 'zod';

export type ManifestInput = z.input<typeof PluginManifestSchema>;

const DEFAULT_FILES: Readonly<Record<string, string>> = {
  'overlay/index.html':
    '<!doctype html>\n<html>\n<head><title>Counter</title></head>\n<body></body>\n</html>\n',
  'icons/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
};

/**
 * A valid plugin `fixture.widgets` with one widget type, `counter`: settings `label` and `step`,
 * an 800 × 600 overlay, a queued `bump` action, an immediate `ping` action and a
 * `counter.changed` event.
 */
export function fixtureManifest(overrides: Partial<ManifestInput> = {}): ManifestInput {
  return {
    id: 'fixture.widgets',
    name: 'Fixture widgets',
    version: '1.0.0',
    apiVersion: 1,
    icon: 'icons/icon.svg',
    widgets: [
      {
        type: 'counter',
        name: 'Counter',
        settings: {
          type: 'object',
          properties: {
            label: { type: 'string', default: 'Count' },
            step: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
          },
        },
        overlay: { entry: 'overlay/index.html', width: 800, height: 600 },
        actions: [
          {
            name: 'bump',
            title: 'Bump',
            queued: true,
            params: {
              type: 'object',
              properties: { by: { type: 'integer' } },
              required: ['by'],
            },
            sample: { by: 1 },
          },
          { name: 'ping', title: 'Ping' },
        ],
        events: [
          {
            name: 'counter.changed',
            title: 'Counter changed',
            payload: {
              type: 'object',
              properties: { value: { type: 'integer' } },
              required: ['value'],
            },
            sample: { value: 1 },
          },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * Writes a plugin folder under `root`: the manifest (a string is written as is, anything else as
 * JSON) and files, on top of a default overlay page and icon. A `null` file is left out.
 * Returns the plugin folder.
 */
export async function writeTestPlugin(
  root: string,
  folder: string,
  manifest: unknown,
  files: Readonly<Record<string, string | null>> = {},
): Promise<string> {
  const dir = join(root, folder);
  await mkdir(dir, { recursive: true });
  const content = typeof manifest === 'string' ? manifest : JSON.stringify(manifest, null, 2);
  await writeFile(join(dir, MANIFEST_FILE), content);
  for (const [path, data] of Object.entries({ ...DEFAULT_FILES, ...files })) {
    if (data === null) continue;
    const target = join(dir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  return dir;
}
