import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { buildTestApp, sessionCookie, TEST_HOST } from '../testing/app.js';

const host = TEST_HOST;
const html = { host, accept: 'text/html,application/xhtml+xml' };
let dashboardDir: string;

beforeAll(async () => {
  dashboardDir = await mkdtemp(join(tmpdir(), 'overly-dashboard-'));
  await mkdir(join(dashboardDir, 'static'));
  await writeFile(join(dashboardDir, 'index.html'), '<!doctype html><title>Overly</title>');
  await writeFile(join(dashboardDir, 'static', 'app.js'), 'console.log("app")');
});

describe('dashboard serving', () => {
  it('serves index.html at / with X-Frame-Options DENY', async () => {
    const { app } = await buildTestApp({ dashboardDir });
    const res = await app.inject({ url: '/', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('<title>Overly</title>');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('serves built files', async () => {
    const { app } = await buildTestApp({ dashboardDir });
    const res = await app.inject({ url: '/static/app.js', headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('javascript');
    expect(res.body).toBe('console.log("app")');
  });

  it('falls back to index.html for client routes', async () => {
    const { app } = await buildTestApp({ dashboardDir });
    const res = await app.inject({ url: '/widgets/abc', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<title>Overly</title>');
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('does not fall back for missing files or reserved paths', async () => {
    const { app, tokens } = await buildTestApp({ dashboardDir });
    const missing = await app.inject({
      url: '/static/missing.js',
      headers: { host, accept: '*/*' },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
    const cookie = await sessionCookie(app, tokens);
    for (const url of ['/api/nope', '/o/x', '/assets/x', '/ws/x']) {
      const res = await app.inject({ url, headers: { ...html, cookie } });
      expect(res.statusCode, url).toBe(404);
      // A JSON error from the route or the 404 handler, never the dashboard page.
      expect(res.headers['content-type'], url).toMatch(/^application\/json/);
    }
  });

  it('still exchanges tokens at /?t=', async () => {
    const { app, tokens } = await buildTestApp({ dashboardDir });
    const res = await app.inject({ url: `/?t=${tokens.issue()}`, headers: html });
    expect(res.statusCode).toBe(303);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('explains a missing dashboard build', async () => {
    const { app } = await buildTestApp({ dashboardDir: join(dashboardDir, 'nope') });
    const res = await app.inject({ url: '/', headers: html });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toBe(
      'The dashboard isn\'t built. Run "bun run build", or use the Vite dev server ("bun run dev").',
    );
  });
});
