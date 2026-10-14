import { expect, it } from 'vitest';

import { ServerMessageSchema, WS_CLOSE_SHUTDOWN } from './messages.js';

it('parses hello', () => {
  expect(ServerMessageSchema.parse({ type: 'hello', version: '0.0.0' })).toEqual({
    type: 'hello',
    version: '0.0.0',
  });
});

it('rejects unknown message types', () => {
  expect(ServerMessageSchema.safeParse({ type: 'nope' }).success).toBe(false);
});

it('closes sockets with 1001 on shutdown', () => {
  expect(WS_CLOSE_SHUTDOWN).toBe(1001);
});
