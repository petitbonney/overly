import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { z } from 'zod';

import { writeFileAtomic } from './atomic-write.js';
import {
  type DocumentLogger,
  DocumentVersionError,
  JsonDocument,
  type Migrations,
} from './json-document.js';

const DocSchema = z.object({
  schemaVersion: z.literal(2),
  server: z.object({ port: z.int().min(1).max(65535) }),
});
type Doc = z.infer<typeof DocSchema>;
const defaults = (): Doc => ({ schemaVersion: 2, server: { port: 6859 } });

let dir: string;
let path: string;
let logger: { warn: Mock<DocumentLogger['warn']> };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'overly-doc-'));
  path = join(dir, 'settings.json');
  logger = { warn: vi.fn<DocumentLogger['warn']>() };
});

function open(
  extra: { migrations?: Migrations; write?: (p: string, d: string) => Promise<void> } = {},
) {
  return JsonDocument.open<Doc>({
    path,
    schema: DocSchema,
    version: 2,
    defaults,
    logger,
    now: () => new Date('2026-10-14T12:34:56.789Z'),
    ...extra,
  });
}

async function readJson(): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}

describe('JsonDocument', () => {
  it('writes the defaults when the file is missing', async () => {
    const doc = await open();
    expect(doc.get()).toEqual(defaults());
    expect(await readJson()).toEqual(defaults());
    expect(await readFile(path, 'utf8')).toMatch(/\n$/);
  });

  it('loads and validates an existing file', async () => {
    await writeFile(path, JSON.stringify({ schemaVersion: 2, server: { port: 7000 } }));
    const doc = await open();
    expect(doc.get().server.port).toBe(7000);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('runs migrations from older versions and saves the result', async () => {
    await writeFile(path, JSON.stringify({ schemaVersion: 1, port: 7001 }));
    const migrations: Migrations = {
      1: (old) => ({ schemaVersion: 2, server: { port: old['port'] } }),
    };
    const doc = await open({ migrations });
    expect(doc.get()).toEqual({ schemaVersion: 2, server: { port: 7001 } });
    expect(await readJson()).toEqual({ schemaVersion: 2, server: { port: 7001 } });
  });

  it('backs up invalid JSON and falls back to the defaults', async () => {
    await writeFile(path, '{ not json');
    const doc = await open();
    expect(doc.get()).toEqual(defaults());
    const backup = join(dir, 'settings.json.corrupt-2026-10-14T12-34-56.789Z');
    expect(await readFile(backup, 'utf8')).toBe('{ not json');
    expect(await readJson()).toEqual(defaults());
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('backs up a file that fails the schema (port 70000)', async () => {
    await writeFile(path, JSON.stringify({ schemaVersion: 2, server: { port: 70000 } }));
    const doc = await open();
    expect(doc.get()).toEqual(defaults());
    expect((await readdir(dir)).sort()).toEqual([
      'settings.json',
      'settings.json.corrupt-2026-10-14T12-34-56.789Z',
    ]);
  });

  it('refuses a file from a newer version and leaves it untouched', async () => {
    const content = JSON.stringify({ schemaVersion: 9, server: { port: 1 } });
    await writeFile(path, content);
    const error: unknown = await open().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DocumentVersionError);
    expect(error).toMatchObject({ found: 9, supported: 2 });
    expect(await readFile(path, 'utf8')).toBe(content);
    expect(await readdir(dir)).toEqual(['settings.json']);
  });

  it('rejects invalid values passed to set and keeps the file', async () => {
    const doc = await open();
    await expect(doc.set({ schemaVersion: 2, server: { port: 0 } })).rejects.toThrow();
    expect(doc.get()).toEqual(defaults());
    expect(await readJson()).toEqual(defaults());
  });

  it('coalesces rapid writes and keeps the last value', async () => {
    const write = vi.fn(writeFileAtomic);
    const doc = await open({ write });
    write.mockClear();
    void doc.set({ schemaVersion: 2, server: { port: 7001 } });
    void doc.set({ schemaVersion: 2, server: { port: 7002 } });
    void doc.set({ schemaVersion: 2, server: { port: 7003 } });
    await doc.flush();
    expect(write.mock.calls.length).toBeLessThanOrEqual(2);
    expect(await readJson()).toEqual({ schemaVersion: 2, server: { port: 7003 } });
    expect(doc.get().server.port).toBe(7003);
  });

  it('flush resolves only after pending writes are on disk', async () => {
    await writeFile(path, JSON.stringify(defaults()));
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const doc = await open({
      write: async (p, d) => {
        await gate;
        await writeFileAtomic(p, d);
      },
    });
    void doc.set({ schemaVersion: 2, server: { port: 7004 } });
    let flushed = false;
    const flushing = doc.flush().then(() => {
      flushed = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(await readJson()).toEqual({ schemaVersion: 2, server: { port: 7004 } });
  });
});
