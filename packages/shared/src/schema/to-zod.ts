import { z } from 'zod';

import type { ArrayField, Field, NumberField, ObjectField, StringField } from './subset.js';

/** `#rrggbb` or `#rrggbbaa`, the values of color fields. */
export const COLOR_PATTERN = /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** An empty string (no asset) or an asset ID. */
const ASSET_VALUE_PATTERN = /^(?:|[a-z0-9]{12})$/;

type Converted = z.ZodType;

function stringSchema(field: StringField): Converted {
  if (field.enum !== undefined) return z.literal(field.enum);
  let schema = z.string();
  if (field.minLength !== undefined) schema = schema.min(field.minLength);
  if (field.maxLength !== undefined) schema = schema.max(field.maxLength);
  const widget = field['x-overly']?.widget;
  if (widget === 'color') schema = schema.regex(COLOR_PATTERN, 'Expected a color like #ff8800');
  if (widget === 'asset') schema = schema.regex(ASSET_VALUE_PATTERN, 'Expected an asset ID');
  return schema;
}

function numberSchema(field: NumberField): Converted {
  let schema = field.type === 'integer' ? z.int() : z.number();
  if (field.minimum !== undefined) schema = schema.min(field.minimum);
  if (field.maximum !== undefined) schema = schema.max(field.maximum);
  if (field.multipleOf !== undefined) schema = schema.multipleOf(field.multipleOf);
  if (field.enum === undefined) return schema;
  const values = field.enum;
  return schema.refine((value) => values.includes(value), {
    message: `Expected one of ${values.join(', ')}`,
  });
}

function arraySchema(field: ArrayField): Converted {
  let schema = z.array(convert(field.items));
  if (field.minItems !== undefined) schema = schema.min(field.minItems);
  if (field.maxItems !== undefined) schema = schema.max(field.maxItems);
  return schema;
}

/** True when every leaf under `field` has a default, so a missing value can be built from them. */
function isFullyDefaulted(field: Field): boolean {
  if (field.type === 'object') return Object.values(field.properties).every(isFullyDefaulted);
  return field.default !== undefined;
}

function objectSchema(field: ObjectField): z.ZodType<Record<string, unknown>> {
  const required = new Set(field.required ?? []);
  const shape: Record<string, Converted> = {};
  for (const [key, child] of Object.entries(field.properties)) {
    const schema = convert(child);
    if (child.type === 'object') {
      // An object without its own default gets one built from its children's defaults.
      shape[key] = isFullyDefaulted(child)
        ? schema.prefault({})
        : required.has(key)
          ? schema
          : schema.optional();
    } else if (child.default !== undefined) {
      // prefault: a missing value becomes the default, and the default itself is validated.
      shape[key] = schema.prefault(child.default);
    } else {
      shape[key] = required.has(key) ? schema : schema.optional();
    }
  }
  // z.object strips unknown keys, which drops settings a newer plugin version removed.
  return z.object(shape);
}

function convert(field: Field): Converted {
  switch (field.type) {
    case 'string':
      return stringSchema(field);
    case 'number':
    case 'integer':
      return numberSchema(field);
    case 'boolean':
      return z.boolean();
    case 'object':
      return objectSchema(field);
    case 'array':
      return arraySchema(field);
  }
}

/** Converts a schema of the plugin subset (ADR 0013) into a Zod schema. */
export function schemaToZod(root: ObjectField): z.ZodType<Record<string, unknown>> {
  return objectSchema(root);
}

/** The settings of a new widget: every default filled in. Throws if a default is invalid. */
export function settingsDefaults(root: ObjectField): Record<string, unknown> {
  return schemaToZod(root).parse({});
}

export interface FormattedIssue {
  path: string;
  message: string;
}

/** Zod issues with dotted paths (`items.1.name`), for API errors and forms. */
export function formatIssues(error: z.ZodError): FormattedIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
