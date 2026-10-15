import { describe, expect, it } from 'vitest';

import { parseCliArgs, UsageError } from './cli.js';

describe('parseCliArgs', () => {
  it('has defaults for every option', () => {
    expect(parseCliArgs([])).toEqual({
      rpc: false,
      dataDir: undefined,
      port: undefined,
      devOrigins: [],
      dashboardDir: undefined,
      pluginsDir: undefined,
      overlaySdk: undefined,
      prettyLogs: false,
    });
  });

  it('parses every option', () => {
    expect(
      parseCliArgs([
        '--rpc',
        '--data-dir',
        'x',
        '--port',
        '0',
        '--dev-origin',
        'http://a',
        '--dev-origin',
        'http://b',
        '--dashboard-dir',
        'd',
        '--plugins-dir',
        'p',
        '--overlay-sdk',
        's.js',
        '--pretty-logs',
      ]),
    ).toEqual({
      rpc: true,
      dataDir: 'x',
      port: 0,
      devOrigins: ['http://a', 'http://b'],
      dashboardDir: 'd',
      pluginsDir: 'p',
      overlaySdk: 's.js',
      prettyLogs: true,
    });
  });

  it('rejects an invalid port', () => {
    for (const port of ['70000', 'abc', '-1', '1.5']) {
      expect(() => parseCliArgs(['--port', port])).toThrow(UsageError);
    }
  });

  it('rejects unknown options', () => {
    expect(() => parseCliArgs(['--nope'])).toThrow(UsageError);
  });
});
