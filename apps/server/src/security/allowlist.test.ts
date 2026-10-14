import { describe, expect, it } from 'vitest';

import { createAllowlist, requiresOrigin, requiresSession } from './allowlist.js';

const allowlist = createAllowlist(() => 6859, ['http://localhost:5173']);

describe('createAllowlist', () => {
  it('allows the loopback hosts on the current port, in any case', () => {
    for (const host of ['127.0.0.1:6859', 'localhost:6859', 'LOCALHOST:6859']) {
      expect(allowlist.isAllowedHost(host)).toBe(true);
    }
  });

  it('rejects other hosts and ports', () => {
    for (const host of [
      'evil.com:6859',
      '127.0.0.1:80',
      '127.0.0.1',
      '[::1]:6859',
      '',
      undefined,
    ]) {
      expect(allowlist.isAllowedHost(host)).toBe(false);
    }
  });

  it('follows the current port', () => {
    let port = 1000;
    const dynamic = createAllowlist(() => port, []);
    expect(dynamic.isAllowedHost('127.0.0.1:1000')).toBe(true);
    port = 2000;
    expect(dynamic.isAllowedHost('127.0.0.1:1000')).toBe(false);
    expect(dynamic.isAllowedOrigin('http://127.0.0.1:2000')).toBe(true);
  });

  it('allows only the loopback origins and dev origins', () => {
    for (const origin of [
      'http://127.0.0.1:6859',
      'http://localhost:6859',
      'http://localhost:5173',
    ]) {
      expect(allowlist.isAllowedOrigin(origin)).toBe(true);
    }
    for (const origin of [
      'null',
      'http://evil.com',
      'https://127.0.0.1:6859',
      'http://127.0.0.1:5173',
      undefined,
    ]) {
      expect(allowlist.isAllowedOrigin(origin)).toBe(false);
    }
  });
});

describe('rules', () => {
  it('requires a session for /api and /ws but not /api/health', () => {
    expect(requiresSession('/api/session')).toBe(true);
    expect(requiresSession('/api/widgets/1')).toBe(true);
    expect(requiresSession('/ws')).toBe(true);
    expect(requiresSession('/api/health')).toBe(false);
    expect(requiresSession('/')).toBe(false);
    expect(requiresSession('/static/app.js')).toBe(false);
    expect(requiresSession('/apis')).toBe(false);
  });

  it('requires an origin on state-changing methods and upgrades', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
      expect(requiresOrigin(method, false)).toBe(true);
    for (const method of ['GET', 'HEAD', 'OPTIONS'])
      expect(requiresOrigin(method, false)).toBe(false);
    expect(requiresOrigin('GET', true)).toBe(true);
  });
});
