import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it, vi } from 'vitest';

import { writeFileAtomic } from './atomic-write.js';
import { SerializedWriter } from './serialized-writer.js';

async function tempFile(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), 'overly-writer-')), 'doc.json');
}

it('coalesces three schedules into at most two writes, keeping the last', async () => {
  const path = await tempFile();
  const write = vi.fn(writeFileAtomic);
  const writer = new SerializedWriter(path, write);
  void writer.schedule('one');
  void writer.schedule('two');
  void writer.schedule('three');
  await writer.flush();
  expect(write.mock.calls.length).toBeLessThanOrEqual(2);
  expect(write.mock.calls.at(-1)?.[1]).toBe('three');
  expect(await readFile(path, 'utf8')).toBe('three');
});

it('flush resolves after the pending write is on disk', async () => {
  const path = await tempFile();
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.fn(async (target: string, data: string) => {
    await gate;
    await writeFileAtomic(target, data);
  });
  const writer = new SerializedWriter(path, write);
  void writer.schedule('first');
  let flushed = false;
  const flushing = writer.flush().then(() => {
    flushed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(flushed).toBe(false);
  release();
  await flushing;
  expect(await readFile(path, 'utf8')).toBe('first');
});

it('flush resolves at once when nothing is pending', async () => {
  await expect(new SerializedWriter(await tempFile()).flush()).resolves.toBeUndefined();
});
