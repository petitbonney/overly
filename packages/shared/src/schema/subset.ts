import { z } from 'zod';

import { PROPERTY_KEY_PATTERN } from '../ids.js';

// The subset of JSON Schema that plugins use for settings, action parameters and outputs, and
// event payloads (ADR 0013). Anything outside it is a manifest error, so every valid manifest
// can be validated (schemaToZod) and rendered as a form by the dashboard.

export const ASSET_KINDS = ['image', 'audio', 'video', 'font'] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const MAX_SCHEMA_DEPTH = 5;
export const MAX_PROPERTIES = 100;

export const UI_WIDGETS = ['textarea', 'color', 'asset', 'slider'] as const;

/** UI hints under the `x-overly` key. */
export interface UiHints {
  widget?: (typeof UI_WIDGETS)[number] | undefined;
  accept?: AssetKind[] | undefined;
  unit?: string | undefined;
  placeholder?: string | undefined;
  enumLabels?: string[] | undefined;
}

interface FieldBase {
  title?: string | undefined;
  description?: string | undefined;
  'x-overly'?: UiHints | undefined;
}

export interface StringField extends FieldBase {
  type: 'string';
  default?: string | undefined;
  enum?: string[] | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
}

export interface NumberField extends FieldBase {
  type: 'number' | 'integer';
  default?: number | undefined;
  enum?: number[] | undefined;
  minimum?: number | undefined;
  maximum?: number | undefined;
  multipleOf?: number | undefined;
}

export interface BooleanField extends FieldBase {
  type: 'boolean';
  default?: boolean | undefined;
}

export interface ObjectField extends FieldBase {
  type: 'object';
  properties: Record<string, Field>;
  required?: string[] | undefined;
}

export interface ArrayField extends FieldBase {
  type: 'array';
  items: Field;
  default?: unknown[] | undefined;
  minItems?: number | undefined;
  maxItems?: number | undefined;
}

export type Field = StringField | NumberField | BooleanField | ObjectField | ArrayField;

const UiHintsSchema = z.strictObject({
  widget: z.enum(UI_WIDGETS).optional(),
  accept: z.array(AssetKindSchema).min(1).optional(),
  unit: z.string().max(16).optional(),
  placeholder: z.string().max(100).optional(),
  enumLabels: z.array(z.string().max(100)).optional(),
});

const base = {
  title: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  'x-overly': UiHintsSchema.optional(),
};

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

const StringFieldSchema = z.strictObject({
  type: z.literal('string'),
  ...base,
  default: z.string().optional(),
  enum: z.array(z.string()).min(1).max(100).refine(unique, 'enum values must be unique').optional(),
  minLength: z.int().min(0).optional(),
  maxLength: z.int().min(0).max(100_000).optional(),
});

const NumberFieldSchema = z.strictObject({
  type: z.enum(['number', 'integer']),
  ...base,
  default: z.number().optional(),
  enum: z.array(z.number()).min(1).max(100).refine(unique, 'enum values must be unique').optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  multipleOf: z.number().positive().optional(),
});

const BooleanFieldSchema = z.strictObject({
  type: z.literal('boolean'),
  ...base,
  default: z.boolean().optional(),
});

const PropertiesSchema = z
  .record(
    z.string().regex(PROPERTY_KEY_PATTERN, 'Property keys start with a letter'),
    z.lazy((): z.ZodType<Field> => FieldSchema),
  )
  .refine((properties) => Object.keys(properties).length <= MAX_PROPERTIES, {
    message: `At most ${String(MAX_PROPERTIES)} properties`,
  });

const ObjectFieldShape = z.strictObject({
  type: z.literal('object'),
  ...base,
  properties: PropertiesSchema,
  required: z.array(z.string()).optional(),
});

/** An object schema. Settings, params, outputs and payloads are always one at their root. */
export const ObjectFieldSchema: z.ZodType<ObjectField> = ObjectFieldShape;

const ArrayFieldSchema = z.strictObject({
  type: z.literal('array'),
  ...base,
  items: z.lazy((): z.ZodType<Field> => FieldSchema),
  default: z.array(z.unknown()).optional(),
  minItems: z.int().min(0).optional(),
  maxItems: z.int().min(0).max(1000).optional(),
});

export const FieldSchema: z.ZodType<Field> = z.lazy(() =>
  z.discriminatedUnion('type', [
    StringFieldSchema,
    NumberFieldSchema,
    BooleanFieldSchema,
    ObjectFieldShape,
    ArrayFieldSchema,
  ]),
);

const STRING_ONLY_WIDGETS = new Set(['textarea', 'color', 'asset']);

/**
 * Rules the Zod validator can't express with readable messages: nesting depth, `required` keys,
 * hints on the wrong type, and (for settings) a default on every leaf. Returns
 * `"<path>: <problem>"` messages; an empty list means the schema is fine.
 */
export function checkSchemaRules(
  root: ObjectField,
  options: { requireDefaults: boolean; path: string },
): string[] {
  const problems: string[] = [];

  const visit = (field: Field, path: string, depth: number): void => {
    const hints = field['x-overly'];
    const widget = hints?.widget;
    if (widget !== undefined) {
      if (STRING_ONLY_WIDGETS.has(widget) && field.type !== 'string') {
        problems.push(`${path}: the ${widget} widget only applies to strings`);
      }
      if (widget === 'slider') {
        if (field.type !== 'number' && field.type !== 'integer') {
          problems.push(`${path}: the slider widget only applies to numbers`);
        } else if (field.minimum === undefined || field.maximum === undefined) {
          problems.push(`${path}: a slider needs minimum and maximum`);
        }
      }
      if (widget === 'asset' && field.type === 'string' && hints?.accept === undefined) {
        problems.push(`${path}: an asset field needs accept`);
      }
    }
    if (hints?.enumLabels !== undefined) {
      const values =
        field.type === 'string' || field.type === 'number' || field.type === 'integer'
          ? field.enum
          : undefined;
      if (values?.length !== hints.enumLabels.length) {
        problems.push(`${path}: enumLabels needs one label per enum value`);
      }
    }

    switch (field.type) {
      case 'object': {
        if (depth > MAX_SCHEMA_DEPTH) {
          problems.push(`${path}: nested deeper than ${String(MAX_SCHEMA_DEPTH)} levels`);
          return;
        }
        for (const key of field.required ?? []) {
          if (!(key in field.properties)) {
            problems.push(`${path}: required lists "${key}", which is not a property`);
          }
        }
        for (const [key, child] of Object.entries(field.properties)) {
          visit(child, `${path}.properties.${key}`, depth + 1);
        }
        return;
      }
      case 'array':
        if (options.requireDefaults && field.default === undefined) {
          problems.push(`${path}: needs a default`);
        }
        if (depth > MAX_SCHEMA_DEPTH) {
          problems.push(`${path}: nested deeper than ${String(MAX_SCHEMA_DEPTH)} levels`);
          return;
        }
        visit(field.items, `${path}.items`, depth + 1);
        return;
      default:
        if (options.requireDefaults && field.default === undefined) {
          problems.push(`${path}: needs a default`);
        }
    }
  };

  visit(root, options.path, 1);
  return problems;
}
