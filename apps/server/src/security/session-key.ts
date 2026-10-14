import { randomBytes } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SESSION_KEY_FILE = 'session.key';

const KEY_BYTES = 32;

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

/**
 * The key that signs dashboard session cookies, stored in the data folder so sessions survive
 * server restarts. Deleting the file signs every browser out.
 */
export async function loadOrCreateSessionKey(dataDir: string): Promise<Buffer> {
  const path = join(dataDir, SESSION_KEY_FILE);
  try {
    const existing = Buffer.from((await readFile(path, 'utf8')).trim(), 'base64');
    if (existing.length === KEY_BYTES) return existing;
    // Invalid content: replace it with a new key.
    await rm(path, { force: true });
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }

  const key = randomBytes(KEY_BYTES);
  try {
    // Owner-only, and never overwrite a key another process just created.
    await writeFile(path, key.toString('base64'), { mode: 0o600, flag: 'wx' });
    return key;
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return loadOrCreateSessionKey(dataDir);
    throw error;
  }
}
