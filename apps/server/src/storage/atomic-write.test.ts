import { mkdtemp, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { writeFileAtomic } from './atomic-write.js';

let dir: string;
let target: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overly-atomic-'));
  target = join(dir, 'doc.json');
});

function errorWithCode(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('writeFileAtomic', () => {
  it('replaces the file content and leaves no temp files', async () => {
    await writeFile(target, 'old');
    await writeFileAtomic(target, 'new');
    expect(await readFile(target, 'utf8')).toBe('new');
    expect(await readdir(dir)).toEqual(['doc.json']);
  });

  it('retries the rename on EPERM, then succeeds', async () => {
    const flaky = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(errorWithCode('EPERM'))
      .mockRejectedValueOnce(errorWithCode('EPERM'))
      .mockImplementation(rename);
    await writeFileAtomic(target, 'content', { rename: flaky, retryDelayMs: 1 });
    expect(flaky).toHaveBeenCalledTimes(3);
    expect(await readFile(target, 'utf8')).toBe('content');
  });

  it('does not retry other errors', async () => {
    const failing = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValue(errorWithCode('ENOSPC'));
    await expect(
      writeFileAtomic(target, 'content', { rename: failing, retryDelayMs: 1 }),
    ).rejects.toThrow('ENOSPC');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('removes the temp file when the rename keeps failing', async () => {
    const failing = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValue(errorWithCode('EBUSY'));
    await expect(
      writeFileAtomic(target, 'content', { rename: failing, retries: 2, retryDelayMs: 1 }),
    ).rejects.toThrow('EBUSY');
    expect(failing).toHaveBeenCalledTimes(3);
    expect(await readdir(dir)).toEqual([]);
  });
});
