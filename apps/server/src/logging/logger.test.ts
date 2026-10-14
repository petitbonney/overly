import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogger, redactUrl } from './logger.js';

const serverDir = join(import.meta.dirname, '..', '..');

describe('redactUrl', () => {
  it('redacts the one-time token and keeps other parameters', () => {
    expect(redactUrl('/?t=abc&x=1')).toBe('/?t=%5Bredacted%5D&x=1');
    expect(redactUrl('/api/health')).toBe('/api/health');
    expect(redactUrl('/?x=1')).toBe('/?x=1');
  });
});

describe('createLogger', () => {
  it('writes JSON lines to a numbered file in the log directory', async () => {
    const logDir = join(await mkdtemp(join(tmpdir(), 'overly-log-')), 'logs');
    const { logger, flush } = await createLogger({ logDir, pretty: false });
    logger.info({ hello: 1 }, 'x');
    await flush();
    const files = await readdir(logDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^overly\.\d+\.log$/);
    const line: unknown = JSON.parse(
      (await readFile(join(logDir, String(files[0])), 'utf8')).trim(),
    );
    expect(line).toMatchObject({ msg: 'x', hello: 1, level: 30 });
  });

  it('keeps at most 5 log files, including files left by earlier runs', async () => {
    const logDir = join(await mkdtemp(join(tmpdir(), 'overly-log-')), 'logs');
    await mkdir(logDir);
    // Earlier runs (app restarts, crash restarts) left 8 files behind.
    for (let n = 1; n <= 8; n++) await writeFile(join(logDir, `overly.${String(n)}.log`), 'old\n');

    const { logger, flush } = await createLogger({ logDir, pretty: false, maxSize: '1k' });
    for (let i = 0; i < 40; i++) logger.info({ filler: 'x'.repeat(100) }, 'line');
    await flush();

    await expect
      .poll(async () => (await readdir(logDir)).filter((f) => /^overly\.\d+\.log$/.test(f)).length)
      .toBeLessThanOrEqual(5);
  });

  it('never writes to stdout, even with pretty logs', async () => {
    const logDir = join(await mkdtemp(join(tmpdir(), 'overly-log-')), 'logs');
    const script = `
      const { createLogger } = await import('./src/logging/logger.ts');
      const { logger, flush } = await createLogger({ logDir: ${JSON.stringify(logDir)}, pretty: true });
      logger.info('visible on stderr');
      await flush();
    `;
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { cwd: serverDir, encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('visible on stderr');
  });
});
