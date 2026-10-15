import { ActionIcon, Button, Fieldset, Group, Stack, Text } from '@mantine/core';
import type { ArrayField as ArrayFieldSchema } from '@overly/shared';

import { FieldInput, SchemaFields, type SchemaForm } from './SchemaFields.js';
import { itemDefaults } from './validate.js';

/** A list of items with Add and Remove buttons; new items get the item schema's defaults. */
export function ArrayField({
  field,
  name,
  path,
  form,
  disabled,
}: {
  field: ArrayFieldSchema;
  name: string;
  path: string;
  form: SchemaForm;
  disabled: boolean;
}) {
  const value: unknown = form.getInputProps(path).value;
  const items = Array.isArray(value) ? value : [];
  const full = field.maxItems !== undefined && items.length >= field.maxItems;
  const label = field.title ?? name;
  const { items: itemSchema } = field;

  return (
    <Fieldset legend={label} disabled={disabled}>
      <Stack gap="sm">
        {field.description !== undefined && (
          <Text size="xs" c="dimmed">
            {field.description}
          </Text>
        )}
        {items.map((_item, index) => (
          // Items have no identity of their own: the index is the key, as in the form path.
          <Group key={index} align="flex-start" wrap="nowrap">
            <div style={{ flex: 1 }}>
              {itemSchema.type === 'object' ? (
                <SchemaFields
                  schema={itemSchema}
                  form={form}
                  path={`${path}.${String(index)}`}
                  disabled={disabled}
                />
              ) : (
                <FieldInput
                  field={itemSchema}
                  name={`${label} ${String(index + 1)}`}
                  path={`${path}.${String(index)}`}
                  form={form}
                  disabled={disabled}
                />
              )}
            </div>
            <ActionIcon
              variant="subtle"
              color="red"
              mt={4}
              aria-label={`Remove item ${String(index + 1)}`}
              disabled={disabled}
              onClick={() => {
                form.removeListItem(path, index);
              }}
            >
              ×
            </ActionIcon>
          </Group>
        ))}
        <Group>
          <Button
            variant="default"
            size="xs"
            disabled={disabled || full}
            onClick={() => {
              form.insertListItem(path, itemDefaults(itemSchema));
            }}
          >
            Add
          </Button>
        </Group>
      </Stack>
    </Fieldset>
  );
}
