import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { loadOrCreateSessionKey, SESSION_KEY_FILE } from './session-key.js';

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'overly-key-'));
});

describe('loadOrCreateSessionKey', () => {
  it('creates a 32-byte session key and returns the same key next time', async () => {
    const first = await loadOrCreateSessionKey(dataDir);
    expect(first).toHaveLength(32);
    expect(await loadOrCreateSessionKey(dataDir)).toEqual(first);
  });

  it.skipIf(process.platform === 'win32')('creates session.key with mode 0600', async () => {
    await loadOrCreateSessionKey(dataDir);
    expect((await stat(join(dataDir, SESSION_KEY_FILE))).mode & 0o777).toBe(0o600);
  });

  it('replaces a session key file with invalid content', async () => {
    await writeFile(join(dataDir, SESSION_KEY_FILE), 'too short');
    const key = await loadOrCreateSessionKey(dataDir);
    expect(key).toHaveLength(32);
    expect(Buffer.from(await readFile(join(dataDir, SESSION_KEY_FILE), 'utf8'), 'base64')).toEqual(
      key,
    );
  });
});

it.skipIf(process.platform === 'win32')(
  'keeps mode 0600 when it replaces an invalid key',
  async () => {
    await writeFile(join(dataDir, SESSION_KEY_FILE), 'too short', { mode: 0o644 });
    await loadOrCreateSessionKey(dataDir);
    expect((await stat(join(dataDir, SESSION_KEY_FILE))).mode & 0o777).toBe(0o600);
  },
);
