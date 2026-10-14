import { describe, expect, it } from 'vitest';

import { resolveDataDir } from './data-dir.js';

describe('resolveDataDir', () => {
  it.each([
    [
      'win32',
      { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' },
      'C:\\Users\\a',
      'C:\\Users\\a\\AppData\\Roaming\\Overly',
    ],
    ['win32', {}, 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Roaming\\Overly'],
    ['darwin', {}, '/Users/a', '/Users/a/Library/Application Support/Overly'],
    ['linux', { XDG_DATA_HOME: '/x' }, '/home/a', '/x/overly'],
    ['linux', {}, '/home/a', '/home/a/.local/share/overly'],
  ] as const)('uses the %s default (%o)', (platform, env, homedir, expected) => {
    expect(resolveDataDir({ platform, env, homedir, cwd: '/' })).toBe(expected);
  });

  it('prefers --data-dir over OVERLY_DATA_DIR over the default', () => {
    const base = { platform: 'linux', homedir: '/home/a', cwd: '/' } as const;
    expect(resolveDataDir({ ...base, env: { OVERLY_DATA_DIR: '/env' }, override: '/flag' })).toBe(
      '/flag',
    );
    expect(resolveDataDir({ ...base, env: { OVERLY_DATA_DIR: '/env' } })).toBe('/env');
    expect(resolveDataDir({ ...base, env: { OVERLY_DATA_DIR: '' } })).toBe(
      '/home/a/.local/share/overly',
    );
  });

  it('resolves a relative override against cwd', () => {
    expect(
      resolveDataDir({
        platform: 'linux',
        env: {},
        homedir: '/home/a',
        cwd: '/repo/apps/server',
        override: '../.dev-data',
      }),
    ).toBe('/repo/apps/.dev-data');
    expect(
      resolveDataDir({
        platform: 'win32',
        env: { OVERLY_DATA_DIR: 'data' },
        homedir: 'C:\\Users\\a',
        cwd: 'C:\\repo',
      }),
    ).toBe('C:\\repo\\data');
  });
});
