import { RANDOM_ID_PATTERN } from '@overly/shared';
import { expect, it } from 'vitest';

import { randomId } from './random-id.js';

it('generates 12-character IDs from [a-z0-9]', () => {
  const ids = Array.from({ length: 1000 }, randomId);
  for (const id of ids) expect(id).toMatch(RANDOM_ID_PATTERN);
  expect(new Set(ids).size).toBe(1000);
});

it('uses every character of the alphabet', () => {
  const seen = new Set(Array.from({ length: 2000 }, randomId).join(''));
  expect(seen.size).toBe(36);
});
