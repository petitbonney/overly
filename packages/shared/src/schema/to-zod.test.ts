import { describe, expect, it } from 'vitest';

import type { Field, ObjectField } from './subset.js';
import { formatIssues, schemaToZod, settingsDefaults } from './to-zod.js';

function obj(properties: Record<string, Field>, required?: string[]): ObjectField {
  return required === undefined
    ? { type: 'object', properties }
    : { type: 'object', properties, required };
}

function accepts(field: Field, value: unknown): boolean {
  return schemaToZod(obj({ v: field }, ['v'])).safeParse({ v: value }).success;
}

describe('schemaToZod', () => {
  it('fills defaults, including nested objects', () => {
    const schema = obj({
      a: { type: 'string', default: 'abc' },
      n: { type: 'integer', default: 3 },
      inner: { type: 'object', properties: { c: { type: 'boolean', default: true } } },
    });
    expect(settingsDefaults(schema)).toEqual({ a: 'abc', n: 3, inner: { c: true } });
    expect(schemaToZod(schema).parse({ a: 'x' })).toEqual({ a: 'x', n: 3, inner: { c: true } });
  });

  it('fails when a default breaks its own schema', () => {
    expect(() =>
      settingsDefaults(obj({ a: { type: 'string', maxLength: 2, default: 'toolong' } })),
    ).toThrow();
  });

  it('strips unknown keys', () => {
    const schema = obj({ a: { type: 'string', default: 'x' } });
    expect(schemaToZod(schema).parse({ a: 'y', removed: 1 })).toEqual({ a: 'y' });
  });

  it('keeps required params required and others optional', () => {
    const schema = obj(
      {
        title: { type: 'string' },
        message: { type: 'string', default: '' },
        note: { type: 'string' },
        extra: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      },
      ['title'],
    );
    const zod = schemaToZod(schema);
    expect(zod.safeParse({}).success).toBe(false);
    expect(zod.parse({ title: 't' })).toEqual({ title: 't', message: '' });
    expect(zod.safeParse({ title: 't', extra: {} }).success).toBe(false);
  });

  it.each([
    [1.5, false],
    [2, true],
    ['2', false],
  ])('treats %s as an integer: %s', (value, ok) => {
    expect(accepts({ type: 'integer' }, value)).toBe(ok);
  });

  it('checks minimum, maximum, multipleOf, enum, minItems and maxItems', () => {
    const number: Field = { type: 'number', minimum: 1, maximum: 5, multipleOf: 0.5 };
    expect(accepts(number, 1)).toBe(true);
    expect(accepts(number, 4.5)).toBe(true);
    expect(accepts(number, 0.5)).toBe(false);
    expect(accepts(number, 5.5)).toBe(false);
    expect(accepts(number, 1.2)).toBe(false);
    expect(accepts({ type: 'string', enum: ['a', 'b'] }, 'b')).toBe(true);
    expect(accepts({ type: 'string', enum: ['a', 'b'] }, 'c')).toBe(false);
    expect(accepts({ type: 'integer', enum: [1, 2] }, 3)).toBe(false);
    expect(accepts({ type: 'string', minLength: 2, maxLength: 3 }, 'a')).toBe(false);
    expect(accepts({ type: 'string', minLength: 2, maxLength: 3 }, 'abcd')).toBe(false);
    const list: Field = { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 2 };
    expect(accepts(list, [1])).toBe(true);
    expect(accepts(list, [])).toBe(false);
    expect(accepts(list, [1, 2, 3])).toBe(false);
    expect(accepts(list, ['x'])).toBe(false);
  });

  it('accepts #rrggbb and #rrggbbaa colors only', () => {
    const color: Field = { type: 'string', 'x-overly': { widget: 'color' } };
    expect(accepts(color, '#A0b1C2')).toBe(true);
    expect(accepts(color, '#000000b3')).toBe(true);
    expect(accepts(color, '#fff')).toBe(false);
    expect(accepts(color, 'red')).toBe(false);
  });

  it('accepts an empty asset or a 12-character ID', () => {
    const asset: Field = { type: 'string', 'x-overly': { widget: 'asset', accept: ['image'] } };
    expect(accepts(asset, '')).toBe(true);
    expect(accepts(asset, 'abcdefghij12')).toBe(true);
    expect(accepts(asset, 'ABC')).toBe(false);
    expect(accepts(asset, '../x')).toBe(false);
  });

  it('fills array defaults', () => {
    const schema = obj({ tags: { type: 'array', items: { type: 'string' }, default: ['a'] } });
    expect(settingsDefaults(schema)).toEqual({ tags: ['a'] });
  });
});

describe('formatIssues', () => {
  it('formats issue paths with dots', () => {
    const schema = obj({
      items: {
        type: 'array',
        items: obj({ name: { type: 'string', minLength: 1 } }, ['name']),
      },
    });
    const result = schemaToZod(schema).safeParse({ items: [{ name: 'ok' }, { name: '' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatIssues(result.error).map((issue) => issue.path)).toEqual(['items.1.name']);
  });
});
