import {
  type Field,
  formatIssues,
  type ObjectField,
  schemaToZod,
  settingsDefaults,
} from '@overly/shared';

/**
 * Validates `values` with the plugin schema and returns Mantine form errors keyed by field path
 * under `path` (`settings.items.0.label`). The first message per field wins.
 */
export function validateWithSchema(
  schema: ObjectField,
  values: unknown,
  path: string,
): Record<string, string> {
  const result = schemaToZod(schema).safeParse(values);
  if (result.success) return {};
  const errors: Record<string, string> = {};
  for (const issue of formatIssues(result.error)) {
    const key = issue.path === '' ? path : `${path}.${issue.path}`;
    errors[key] ??= issue.message;
  }
  return errors;
}

/** The value of a new array item: its default, or the defaults of its object fields. */
export function itemDefaults(items: Field): unknown {
  if (items.type === 'object') return settingsDefaults(items);
  if (items.default !== undefined) return items.default;
  switch (items.type) {
    case 'string':
      return '';
    case 'boolean':
      return false;
    case 'array':
      return [];
    case 'number':
    case 'integer':
      return items.minimum ?? 0;
  }
}
