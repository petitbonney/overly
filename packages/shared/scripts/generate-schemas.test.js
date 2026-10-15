// Lives next to the generator because it reads files: @overly/shared's own sources have no Node types.
import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

import { pluginManifestJsonSchema } from '../src/plugin/json-schema.ts';

it('matches docs/plugins/overly.plugin.schema.json (run bun run generate:schemas)', async () => {
  const file = await readFile(
    new URL('../../../docs/plugins/overly.plugin.schema.json', import.meta.url),
    'utf8',
  );
  expect(file).toBe(`${JSON.stringify(pluginManifestJsonSchema(), null, 2)}\n`);
});

it('describes the manifest root and the recursive field schemas', () => {
  const schema = pluginManifestJsonSchema();
  expect(schema).toMatchObject({ type: 'object', additionalProperties: false });
  expect(JSON.stringify(schema)).toContain('x-overly');
});
