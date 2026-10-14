import { expect, it } from 'vitest';

import { ApiErrorBodySchema, HealthResponseSchema, SessionResponseSchema } from './api.js';

it('parses the health, session and error bodies', () => {
  expect(HealthResponseSchema.parse({ status: 'ok', version: '0.0.0' })).toEqual({
    status: 'ok',
    version: '0.0.0',
  });
  expect(SessionResponseSchema.parse({ authenticated: true })).toEqual({ authenticated: true });
  expect(SessionResponseSchema.safeParse({ authenticated: false }).success).toBe(false);
  expect(ApiErrorBodySchema.parse({ error: 'no_session' })).toEqual({ error: 'no_session' });
});
