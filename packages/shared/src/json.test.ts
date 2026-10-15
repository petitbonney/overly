import { expect, it } from 'vitest';

import { JsonValueSchema } from './json.js';

it('accepts nested JSON values', () => {
  const value = { a: [1, 'two', null, true, { b: [] }] };
  expect(JsonValueSchema.parse(value)).toEqual(value);
});

it.each([
  ['undefined', undefined],
  ['a function', () => 1],
  ['NaN', Number.NaN],
  ['a nested undefined', { a: [undefined] }],
])('rejects %s', (_name, value) => {
  expect(JsonValueSchema.safeParse(value).success).toBe(false);
});
