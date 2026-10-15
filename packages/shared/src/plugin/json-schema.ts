import { z } from 'zod';

import { PluginManifestSchema } from './manifest.js';

/**
 * JSON Schema of overly.plugin.json, for editors and plugin authors. Written to
 * docs/plugins/overly.plugin.schema.json by `bun run generate:schemas`. Input mode: fields with
 * defaults are optional, as an author writes them.
 */
export function pluginManifestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(PluginManifestSchema, { io: 'input' });
}
