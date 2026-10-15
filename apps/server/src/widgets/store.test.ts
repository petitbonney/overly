import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { WidgetDocument } from '@overly/shared';
import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { WidgetStore } from './store.js';

const logger = pino({ level: 'silent' });
let dir: string;
let clock: Date;

function doc(overrides: Partial<WidgetDocument> = {}): WidgetDocument {
  return {
    schemaVersion: 1,
    id: 'abcdefghij12',
    type: 'fixture.widgets:counter',
    name: 'Counter',
    enabled: true,
    pluginVersion: '1.0.0',
    settings: { label: 'Count', step: 1 },
    state: null,
    createdAt: '2026-10-15T08:00:00.000Z',
    updatedAt: '2026-10-15T08:00:00.000Z',
    ...overrides,
  };
}

async function open(): Promise<WidgetStore> {
  return WidgetStore.open({ dir, logger, now: () => clock });
}

beforeEach(async () => {
  dir = join(await mkdtemp(join(tmpdir(), 'overly-widgets-')), 'widgets');
  clock = new Date('2026-10-15T09:00:00.000Z');
});

describe('WidgetStore', () => {
  it('creates a file with two-space JSON and a final newline, and reloads it', async () => {
    const store = await open();
    await store.create(doc());
    expect(await readFile(join(dir, 'abcdefghij12.json'), 'utf8')).toBe(
      `${JSON.stringify(doc(), null, 2)}\n`,
    );
    const reopened = await open();
    expect(reopened.get('abcdefghij12')).toEqual({ kind: 'document', doc: doc() });
  });

  it('refuses to create an invalid document or an existing ID', async () => {
    const store = await open();
    await expect(store.create(doc({ name: '' }))).rejects.toThrow();
    await store.create(doc());
    await expect(store.create(doc())).rejects.toThrow(/already exists/);
  });

  it('update sets updatedAt and keeps the last of several writes', async () => {
    const store = await open();
    await store.create(doc());
    void store.update('abcdefghij12', (current) => ({ ...current, name: 'One' }));
    void store.update('abcdefghij12', (current) => ({ ...current, name: 'Two' }));
    const last = await store.update('abcdefghij12', (current) => ({ ...current, name: 'Three' }));
    await store.flush();
    expect(last).toMatchObject({ name: 'Three', updatedAt: '2026-10-15T09:00:00.000Z' });
    const saved = JSON.parse(await readFile(join(dir, 'abcdefghij12.json'), 'utf8')) as unknown;
    expect(saved).toMatchObject({ name: 'Three', updatedAt: '2026-10-15T09:00:00.000Z' });
  });

  it('rejects an update that breaks the schema and keeps the document', async () => {
    const store = await open();
    await store.create(doc());
    await expect(
      store.update('abcdefghij12', (current) => ({ ...current, name: '' })),
    ).rejects.toThrow();
    expect(store.get('abcdefghij12')).toEqual({ kind: 'document', doc: doc() });
  });

  it('keeps an unreadable file as it is', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'abcdefghij12.json'), '{ broken');
    const store = await open();
    await store.flush();
    expect(store.get('abcdefghij12')).toMatchObject({
      kind: 'unreadable',
      id: 'abcdefghij12',
      code: 'unreadable',
    });
    expect(await readFile(join(dir, 'abcdefghij12.json'), 'utf8')).toBe('{ broken');
    await expect(store.update('abcdefghij12', (current) => current)).rejects.toThrow();
  });

  it('marks a newer schemaVersion as unsupported_version', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'abcdefghij12.json'), JSON.stringify({ ...doc(), schemaVersion: 2 }));
    expect((await open()).get('abcdefghij12')).toMatchObject({
      kind: 'unreadable',
      code: 'unsupported_version',
    });
  });

  it('treats an ID that differs from the file name as unreadable', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'zzzzzzzzzz99.json'), JSON.stringify(doc()));
    expect((await open()).get('zzzzzzzzzz99')).toMatchObject({
      kind: 'unreadable',
      code: 'unreadable',
    });
  });

  it('ignores temp, backup and other files', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'abcdefghij12.json.1a2b.tmp'), 'x');
    await writeFile(join(dir, 'notes.txt'), 'x');
    await writeFile(join(dir, 'ABCDEFGHIJ12.json'), JSON.stringify(doc()));
    expect((await open()).list()).toEqual([]);
  });

  it('deletes documents and unreadable files', async () => {
    const store = await open();
    await store.create(doc());
    await writeFile(join(dir, 'zzzzzzzzzz99.json'), 'nope');
    const reopened = await open();
    await reopened.delete('abcdefghij12');
    await reopened.delete('zzzzzzzzzz99');
    expect(reopened.list()).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it('leaves no file when deleting right after an update', async () => {
    const store = await open();
    await store.create(doc());
    void store.update('abcdefghij12', (current) => ({ ...current, name: 'Late' }));
    await store.delete('abcdefghij12');
    await store.flush();
    expect(await readdir(dir)).toEqual([]);
  });
});
