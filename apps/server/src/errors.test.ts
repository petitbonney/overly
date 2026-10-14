import { describe, expect, it } from 'vitest';

import { listenError, StartupError } from './errors.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`listen ${code}`), { code });
}

describe('listenError', () => {
  it.each([
    ['EADDRINUSE', 'port_in_use'],
    ['EACCES', 'port_unavailable'],
    ['EOTHER', 'startup_failed'],
  ])('maps %s to %s', (code, fatal) => {
    const error = listenError(errno(code), 6859, '/data/settings.json');
    expect(error).toBeInstanceOf(StartupError);
    expect(error.code).toBe(fatal);
  });

  it('names the port and the settings path in the message', () => {
    expect(listenError(errno('EADDRINUSE'), 6859, '/data/settings.json').message).toBe(
      'Port 6859 is already in use by another program. Close it, or change server.port in /data/settings.json.',
    );
    expect(listenError(errno('EACCES'), 6859, '/data/settings.json').message).toBe(
      "Port 6859 can't be used (Windows may reserve it for Hyper-V or WSL). Change server.port in /data/settings.json.",
    );
    expect(listenError(errno('EOTHER'), 6859, '/data/settings.json').message).toBe('listen EOTHER');
  });

  it('handles values that are not errors', () => {
    expect(listenError('weird', 1, 'p')).toMatchObject({
      code: 'startup_failed',
      message: 'weird',
    });
  });
});
