import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';

import { OVERLY_VERSION } from '@overly/shared';
import pino from 'pino';
import { describe, expect, it } from 'vitest';

import { loggerOptions } from '../logging/logger.js';
import { OneTimeTokens } from '../security/tokens.js';
import { buildTestApp, sessionCookie, TEST_HOST, TEST_ORIGIN } from '../testing/app.js';

const host = TEST_HOST;

describe('health', () => {
  it('serves health without a session', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ url: '/api/health', headers: { host } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: OVERLY_VERSION });
  });
});

describe('Host check', () => {
  it('rejects a foreign Host with 403 forbidden_host', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ url: '/api/health', headers: { host: 'evil.com:6859' } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden_host' });
  });

  it('rejects the default inject host (wrong port)', async () => {
    const { app } = await buildTestApp();
    expect((await app.inject({ url: '/api/health' })).statusCode).toBe(403);
  });

  it('accepts LOCALHOST:6859 as a host', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ url: '/api/health', headers: { host: 'LOCALHOST:6859' } });
    expect(res.statusCode).toBe(200);
  });
});

describe('Origin check', () => {
  it('rejects a cross-origin POST with 403 forbidden_origin', async () => {
    const { app, tokens } = await buildTestApp();
    const cookie = await sessionCookie(app, tokens);
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, cookie, origin: 'http://evil.com' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden_origin' });
  });

  it('rejects a POST without Origin', async () => {
    const { app, tokens } = await buildTestApp();
    const cookie = await sessionCookie(app, tokens);
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, cookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects Origin null', async () => {
    const { app, tokens } = await buildTestApp();
    const cookie = await sessionCookie(app, tokens);
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, cookie, origin: 'null' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a POST from an allowed origin through the guard', async () => {
    const { app, tokens } = await buildTestApp();
    const cookie = await sessionCookie(app, tokens);
    const res = await app.inject({
      method: 'POST',
      url: '/api/session',
      headers: { host, cookie, origin: TEST_ORIGIN },
    });
    expect(res.statusCode).toBe(404);
  });

  it('accepts the dev origin only when configured', async () => {
    const headers = { host, origin: 'http://localhost:5173' };
    const plain = await buildTestApp();
    const plainCookie = await sessionCookie(plain.app, plain.tokens);
    expect(
      (
        await plain.app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { ...headers, cookie: plainCookie },
        })
      ).statusCode,
    ).toBe(403);

    const dev = await buildTestApp({ devOrigins: ['http://localhost:5173'] });
    const devCookie = await sessionCookie(dev.app, dev.tokens);
    expect(
      (
        await dev.app.inject({
          method: 'POST',
          url: '/api/session',
          headers: { ...headers, cookie: devCookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe('session', () => {
  it('answers /api/session with 401 no_session without a cookie', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ url: '/api/session', headers: { host } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'no_session' });
  });

  it('requires a session for percent-encoded API paths', async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ url: '/%61pi/session', headers: { host } });
    expect(res.statusCode).not.toBe(200);
  });

  it('exchanges a token for a session cookie and redirects to /', async () => {
    const { app, tokens } = await buildTestApp();
    const res = await app.inject({ url: `/?t=${tokens.issue()}`, headers: { host } });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    expect(res.headers['cache-control']).toBe('no-store');
    const cookie = String(res.headers['set-cookie']);
    for (const part of [
      'overly_session=',
      'HttpOnly',
      'SameSite=Strict',
      'Path=/',
      'Max-Age=2592000',
    ]) {
      expect(cookie).toContain(part);
    }

    const session = await app.inject({
      url: '/api/session',
      headers: { host, cookie: cookie.split(';')[0] ?? '' },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ authenticated: true });
  });

  it('does not set a cookie for a reused or expired token', async () => {
    let now = 0;
    const tokens = new OneTimeTokens({ now: () => now });
    const { app } = await buildTestApp({ tokens });
    const used = tokens.issue();
    await app.inject({ url: `/?t=${used}`, headers: { host } });
    const reused = await app.inject({ url: `/?t=${used}`, headers: { host } });
    expect(reused.statusCode).toBe(303);
    expect(reused.headers['set-cookie']).toBeUndefined();

    const expiring = tokens.issue();
    now = 120_001;
    const expired = await app.inject({ url: `/?t=${expiring}`, headers: { host } });
    expect(expired.statusCode).toBe(303);
    expect(expired.headers['set-cookie']).toBeUndefined();
  });

  it('rejects a tampered cookie', async () => {
    const { app, tokens } = await buildTestApp();
    const cookie = await sessionCookie(app, tokens);
    const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    const res = await app.inject({ url: '/api/session', headers: { host, cookie: tampered } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects a cookie older than 30 days', async () => {
    let now = 1_000_000;
    const { app, tokens } = await buildTestApp({ now: () => now });
    const cookie = await sessionCookie(app, tokens);
    now += 2_592_000_001;
    const res = await app.inject({ url: '/api/session', headers: { host, cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('accepts a cookie issued by a previous server with the same key', async () => {
    const sessionKey = randomBytes(32);
    const before = await buildTestApp({ sessionKey });
    const cookie = await sessionCookie(before.app, before.tokens);
    await before.app.close();

    const after = await buildTestApp({ sessionKey });
    const res = await after.app.inject({ url: '/api/session', headers: { host, cookie } });
    expect(res.statusCode).toBe(200);

    const otherKey = await buildTestApp();
    const rejected = await otherKey.app.inject({ url: '/api/session', headers: { host, cookie } });
    expect(rejected.statusCode).toBe(401);
  });
});

describe('logging and headers', () => {
  it('does not log the one-time token', async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = pino({ ...loggerOptions, level: 'info' }, stream);
    const { app } = await buildTestApp({ logger });
    await app.inject({ url: '/?t=SECRET-TOKEN', headers: { host } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain('SECRET-TOKEN');
  });

  it('sets nosniff and no-referrer on every response', async () => {
    const { app } = await buildTestApp();
    for (const url of ['/api/health', '/api/session']) {
      const res = await app.inject({ url, headers: { host } });
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['referrer-policy']).toBe('no-referrer');
    }
    const rejected = await app.inject({ url: '/api/health', headers: { host: 'evil.com' } });
    expect(rejected.headers['x-content-type-options']).toBe('nosniff');
  });
});
