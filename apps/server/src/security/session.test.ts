import { describe, expect, it } from 'vitest';

import {
  createSessionValue,
  isSessionValueFresh,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
} from './session.js';

describe('session values', () => {
  it('uses the overly_session cookie for 30 days', () => {
    expect(SESSION_COOKIE).toBe('overly_session');
    expect(SESSION_MAX_AGE_SECONDS).toBe(2_592_000);
  });

  it('accepts a fresh session value', () => {
    const value = createSessionValue(1_000);
    expect(isSessionValueFresh(value, 1_000)).toBe(true);
    expect(isSessionValueFresh(value, 1_000 + 2_592_000_000)).toBe(true);
  });

  it('treats a session older than 30 days as stale', () => {
    expect(isSessionValueFresh(createSessionValue(1_000), 1_000 + 2_592_000_001)).toBe(false);
  });

  it('rejects session values without a valid timestamp', () => {
    for (const value of ['abc', 'abc.', 'abc.-5', 'abc.12x', '.1000']) {
      expect(isSessionValueFresh(value, 1_000)).toBe(false);
    }
    expect(isSessionValueFresh(createSessionValue(5_000), 1_000)).toBe(false);
  });

  it('creates a different value each time', () => {
    expect(createSessionValue(1)).not.toBe(createSessionValue(1));
  });
});
