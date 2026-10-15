// Writes docs/plugins/overly.plugin.schema.json from the Zod manifest schema.
// Run with `bun run generate:schemas` after changing the manifest or the schema subset.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { pluginManifestJsonSchema } from '../src/plugin/json-schema.ts';

const target = fileURLToPath(
  new URL('../../../docs/plugins/overly.plugin.schema.json', import.meta.url),
);
await writeFile(target, `${JSON.stringify(pluginManifestJsonSchema(), null, 2)}\n`);
process.stderr.write(`Wrote ${target}\n`);
