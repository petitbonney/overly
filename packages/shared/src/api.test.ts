import { expect, it } from 'vitest';

import {
  ApiErrorBodySchema,
  CreateWidgetBodySchema,
  HealthResponseSchema,
  RunActionBodySchema,
  SessionResponseSchema,
  UpdateWidgetBodySchema,
} from './api.js';

it('parses the health, session and error bodies', () => {
  expect(HealthResponseSchema.parse({ status: 'ok', version: '0.0.0' })).toEqual({
    status: 'ok',
    version: '0.0.0',
  });
  expect(SessionResponseSchema.parse({ authenticated: true })).toEqual({ authenticated: true });
  expect(SessionResponseSchema.safeParse({ authenticated: false }).success).toBe(false);
  expect(ApiErrorBodySchema.parse({ error: 'no_session' })).toEqual({ error: 'no_session' });
});

it('parses errors with issues', () => {
  expect(
    ApiErrorBodySchema.parse({
      error: 'invalid_params',
      message: 'Invalid parameters',
      issues: [{ path: 'title', message: 'Required' }],
    }),
  ).toMatchObject({ issues: [{ path: 'title' }] });
});

it('rejects an empty update body', () => {
  expect(UpdateWidgetBodySchema.safeParse({}).success).toBe(false);
  expect(UpdateWidgetBodySchema.parse({ enabled: false })).toEqual({ enabled: false });
});

it('fills action defaults and bounds the priority', () => {
  expect(RunActionBodySchema.parse({})).toEqual({ params: {}, priority: 0 });
  expect(RunActionBodySchema.safeParse({ priority: 101 }).success).toBe(false);
  expect(RunActionBodySchema.safeParse({ priority: -101 }).success).toBe(false);
});

it('accepts a widget type reference when creating a widget', () => {
  expect(CreateWidgetBodySchema.safeParse({ type: 'overly.alerts:alerts' }).success).toBe(true);
  expect(CreateWidgetBodySchema.safeParse({ type: 'alerts' }).success).toBe(false);
});
