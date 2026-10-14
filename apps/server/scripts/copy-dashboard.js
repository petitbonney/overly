// Copies the dashboard build next to the server bundle: dist/sidecar/dashboard.
import { cp, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../dashboard/dist/web/', import.meta.url));
const target = fileURLToPath(new URL('../dist/sidecar/dashboard/', import.meta.url));

try {
  await stat(source);
} catch {
  process.stderr.write(
    `The dashboard build is missing (${source}). Run "bun run --filter @overly/dashboard build" first.\n`,
  );
  process.exit(1);
}

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
