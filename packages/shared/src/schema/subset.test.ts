import { describe, expect, it } from 'vitest';

import { checkSchemaRules, type Field, type ObjectField, ObjectFieldSchema } from './subset.js';

function obj(properties: Record<string, Field>, extra: Partial<ObjectField> = {}): ObjectField {
  return { type: 'object', properties, ...extra };
}

/** `levels` nested objects, the root included. */
function deep(levels: number): ObjectField {
  let schema: ObjectField = obj({ leaf: { type: 'string', default: '' } });
  for (let level = 1; level < levels; level++) schema = obj({ child: schema });
  return schema;
}

const everything = {
  type: 'object',
  properties: {
    position: {
      type: 'string',
      title: 'Position',
      description: 'Where the banner sits',
      default: 'bottom',
      enum: ['top', 'bottom'],
      'x-overly': { enumLabels: ['Top', 'Bottom'] },
    },
    color: { type: 'string', default: '#ffffff', 'x-overly': { widget: 'color' } },
    template: {
      type: 'string',
      default: '{{title}}',
      maxLength: 500,
      'x-overly': { widget: 'textarea', placeholder: 'Headline' },
    },
    image: { type: 'string', default: '', 'x-overly': { widget: 'asset', accept: ['image'] } },
    volume: {
      type: 'integer',
      default: 80,
      minimum: 0,
      maximum: 100,
      'x-overly': { widget: 'slider', unit: '%' },
    },
    duration: { type: 'number', default: 6, minimum: 1, multipleOf: 0.5 },
    loop: { type: 'boolean', default: false },
    style: {
      type: 'object',
      title: 'Style',
      properties: { size: { type: 'integer', default: 48 } },
    },
    segments: {
      type: 'array',
      default: [],
      maxItems: 50,
      items: {
        type: 'object',
        properties: { label: { type: 'string', default: 'Segment' } },
        required: ['label'],
      },
    },
  },
};

describe('schema subset', () => {
  it('accepts every type and hint of the subset', () => {
    const result = ObjectFieldSchema.safeParse(everything);
    expect(result.error?.issues).toBeUndefined();
    expect(
      checkSchemaRules(everything as ObjectField, { requireDefaults: true, path: 'settings' }),
    ).toEqual([]);
  });

  it.each([
    ['pattern', { type: 'string', pattern: 'a' }],
    ['format', { type: 'string', format: 'uri' }],
    ['oneOf', { oneOf: [] }],
    ['an unknown type', { type: 'date' }],
    ['an unknown hint', { type: 'string', 'x-overly': { widget: 'date' } }],
  ])('rejects %s', (_name, field) => {
    expect(ObjectFieldSchema.safeParse(obj({ a: field as Field })).success).toBe(false);
  });

  it('rejects bad property keys and more than 100 properties', () => {
    for (const key of ['1bad', 'a-b', '']) {
      expect(ObjectFieldSchema.safeParse(obj({ [key]: { type: 'boolean' } })).success).toBe(false);
    }
    const many = Object.fromEntries(
      Array.from({ length: 101 }, (_, i): [string, Field] => [
        `p${String(i)}`,
        { type: 'boolean' },
      ]),
    );
    expect(ObjectFieldSchema.safeParse(obj(many)).success).toBe(false);
  });

  it('rejects a root that is not an object', () => {
    expect(ObjectFieldSchema.safeParse({ type: 'string' }).success).toBe(false);
  });
});

describe('schema rules', () => {
  const rules = (schema: ObjectField) =>
    checkSchemaRules(schema, { requireDefaults: false, path: 'settings' });

  it('allows 5 levels of nesting but not 6', () => {
    expect(rules(deep(5))).toEqual([]);
    expect(rules(deep(6))).toContainEqual(expect.stringContaining('deeper than 5'));
  });

  it('reports required keys that are not properties', () => {
    expect(rules(obj({ a: { type: 'boolean' } }, { required: ['nope'] }))).toEqual([
      'settings: required lists "nope", which is not a property',
    ]);
  });

  it('reports hint problems with their path', () => {
    expect(
      rules(
        obj({
          slider: { type: 'integer', minimum: 0, 'x-overly': { widget: 'slider' } },
          asset: { type: 'string', 'x-overly': { widget: 'asset' } },
          color: { type: 'number', 'x-overly': { widget: 'color' } },
          sliderText: { type: 'string', 'x-overly': { widget: 'slider' } },
          labels: { type: 'string', enum: ['a', 'b'], 'x-overly': { enumLabels: ['A'] } },
          noEnum: { type: 'string', 'x-overly': { enumLabels: ['A'] } },
        }),
      ),
    ).toEqual([
      'settings.properties.slider: a slider needs minimum and maximum',
      'settings.properties.asset: an asset field needs accept',
      'settings.properties.color: the color widget only applies to strings',
      'settings.properties.sliderText: the slider widget only applies to numbers',
      'settings.properties.labels: enumLabels needs one label per enum value',
      'settings.properties.noEnum: enumLabels needs one label per enum value',
    ]);
  });

  it('requires a default on every settings leaf', () => {
    expect(
      checkSchemaRules(obj({ volume: { type: 'integer' } }), {
        requireDefaults: true,
        path: 'settings',
      }),
    ).toEqual(['settings.properties.volume: needs a default']);
  });

  it('requires defaults inside array items for settings', () => {
    const schema = obj({
      list: { type: 'array', default: [], items: obj({ name: { type: 'string' } }) },
    });
    expect(checkSchemaRules(schema, { requireDefaults: true, path: 'settings' })).toEqual([
      'settings.properties.list.items.properties.name: needs a default',
    ]);
    expect(rules(schema)).toEqual([]);
  });
});
