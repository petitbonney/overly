import { expect, it } from 'vitest';

import { reconnectDelay } from './backoff.js';

it('grows the reconnect delay up to 10 s', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(reconnectDelay)).toEqual([
    500, 1000, 2000, 4000, 8000, 10000, 10000,
  ]);
});
