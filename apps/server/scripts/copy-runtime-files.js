// Copies what server.mjs needs next to it in dist/sidecar/: the dashboard build, the built-in
// plugins (manifest and public files only, the same rule the server uses), and the overlay SDK.
// Run by `bun run build` (Bun runs it, so it can import @overly/shared's TypeScript).
import { cp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST_FILE, PluginManifestSchema, publicPaths } from '@overly/shared';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const target = fileURLToPath(new URL('../dist/sidecar/', import.meta.url));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function requireBuild(path, command) {
  if (!(await exists(path))) {
    process.stderr.write(`${path} is missing. Run "${command}" first.\n`);
    process.exit(1);
  }
}

const dashboard = join(repo, 'apps/dashboard/dist/web');
const sdk = join(repo, 'packages/sdk/dist/browser/overlay.js');
await requireBuild(dashboard, 'bun run --filter @overly/dashboard build');
await requireBuild(sdk, 'bun run --filter @overly/sdk build');

await rm(join(target, 'dashboard'), { recursive: true, force: true });
await cp(dashboard, join(target, 'dashboard'), { recursive: true });

await rm(join(target, 'sdk'), { recursive: true, force: true });
await cp(sdk, join(target, 'sdk', 'overlay.js'));

await rm(join(target, 'plugins'), { recursive: true, force: true });
const pluginsDir = join(repo, 'plugins');
for (const entry of await readdir(pluginsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const source = join(pluginsDir, entry.name);
  const manifestPath = join(source, MANIFEST_FILE);
  if (!(await exists(manifestPath))) continue;
  const destination = join(target, 'plugins', entry.name);
  // An invalid manifest is still copied, so the app reports the plugin as broken.
  await cp(manifestPath, join(destination, MANIFEST_FILE));
  const parsed = PluginManifestSchema.safeParse(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!parsed.success) continue;
  const { dirs, files } = publicPaths(parsed.data);
  for (const path of [...dirs, ...files]) {
    if (await exists(join(source, path))) {
      await cp(join(source, path), join(destination, path), { recursive: true });
    }
  }
}
process.stderr.write(`Copied the dashboard, plugins and overlay SDK to ${target}\n`);
