import { globSync } from 'node:fs';
import { dirname } from 'node:path';

import { defineConfig } from 'vitest/config';

// Every TypeScript workspace (a folder with a package.json) is its own Vitest project.
// A workspace can add its own vitest.config.ts. The desktop shell is Rust and tested with cargo.
const projects = globSync([
  'apps/*/package.json',
  'packages/*/package.json',
  'plugins/*/package.json',
])
  .map((manifest) => dirname(manifest).replaceAll('\\', '/'))
  .filter((dir) => dir !== 'apps/desktop');

export default defineConfig({
  test: { projects },
});
