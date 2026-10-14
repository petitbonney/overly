import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultSettings } from '@overly/shared';
import { expect, it, vi } from 'vitest';

import { openSettings, SETTINGS_FILE } from './settings.js';

it('openSettings creates the directory and default settings.json', async () => {
  const dataDir = join(await mkdtemp(join(tmpdir(), 'overly-settings-')), 'a', 'b');
  const settings = await openSettings(dataDir, { warn: vi.fn() });
  expect(settings.get()).toEqual(defaultSettings());
  expect(JSON.parse(await readFile(join(dataDir, SETTINGS_FILE), 'utf8'))).toEqual(
    defaultSettings(),
  );
});
