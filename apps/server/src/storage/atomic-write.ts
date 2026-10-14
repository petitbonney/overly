import { randomBytes } from 'node:crypto';
import { open, rename as fsRename, rm } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

export interface AtomicWriteOptions {
  /** How many times a failed rename is retried. Default 5. */
  retries?: number;
  /** Delay before the first retry, doubled after each one. Default 20 ms. */
  retryDelayMs?: number;
  /** Replaces `fs.rename`, for tests. */
  rename?: (from: string, to: string) => Promise<void>;
}

/** On Windows, antivirus scanners and indexers briefly lock files, which fails a rename with these codes. */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

function isRetryable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    RETRYABLE_RENAME_CODES.has(error.code)
  );
}

/**
 * Writes `data` to `path` so that readers see either the old or the new content, never a mix:
 * write a temp file in the same directory, fsync it, then rename it over the target.
 */
export async function writeFileAtomic(
  path: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const { retries = 5, retryDelayMs = 20, rename = fsRename } = options;
  const tempPath = `${path}.${randomBytes(6).toString('hex')}.tmp`;

  const file = await open(tempPath, 'w');
  try {
    await file.writeFile(data, 'utf8');
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tempPath, path);
        return;
      } catch (error) {
        if (attempt >= retries || !isRetryable(error)) throw error;
        await sleep(retryDelayMs * 2 ** attempt);
      }
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
