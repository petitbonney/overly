import { describe, expect, it } from 'vitest';

import { OneTimeTokens, TOKEN_TTL_MS } from './tokens.js';

describe('OneTimeTokens', () => {
  it('consumes a token only once', () => {
    const tokens = new OneTimeTokens();
    const token = tokens.issue();
    expect(tokens.consume(token)).toBe(true);
    expect(tokens.consume(token)).toBe(false);
  });

  it('expires tokens after 120 s', () => {
    let now = 0;
    const tokens = new OneTimeTokens({ now: () => now });
    const late = tokens.issue();
    const onTime = tokens.issue();
    expect(TOKEN_TTL_MS).toBe(120_000);
    now = 120_000;
    expect(tokens.consume(onTime)).toBe(true);
    now = 120_001;
    expect(tokens.consume(late)).toBe(false);
  });

  it('rejects unknown tokens', () => {
    expect(new OneTimeTokens().consume('nope')).toBe(false);
  });

  it('issues 43-character base64url tokens', () => {
    const tokens = new OneTimeTokens();
    const issued = new Set(Array.from({ length: 20 }, () => tokens.issue()));
    expect(issued.size).toBe(20);
    for (const token of issued) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
