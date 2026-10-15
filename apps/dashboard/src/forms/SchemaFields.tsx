import {
  ColorInput,
  Fieldset,
  Input,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Textarea,
  TextInput,
} from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { Field, NumberField, ObjectField, StringField } from '@overly/shared';
import type { ReactNode } from 'react';

import { AssetField } from '../assets/AssetField.js';
import { ArrayField } from './ArrayField.js';

export type SchemaForm = UseFormReturnType<Record<string, unknown>>;

interface FieldProps<F extends Field> {
  field: F;
  /** The property key, the label when the schema has no title. */
  name: string;
  /** The form path of the value, e.g. `settings.style.color`. */
  path: string;
  form: SchemaForm;
  disabled: boolean;
}

function StringInput({ field, name, path, form, disabled }: FieldProps<StringField>) {
  const label = field.title ?? name;
  const hints = field['x-overly'];
  const common = { label, description: field.description, disabled };
  if (field.enum !== undefined) {
    return (
      <Select
        {...common}
        data={field.enum.map((value, index) => ({
          value,
          label: hints?.enumLabels?.[index] ?? value,
        }))}
        allowDeselect={false}
        {...form.getInputProps(path)}
      />
    );
  }
  switch (hints?.widget) {
    case 'textarea':
      return (
        <Textarea
          {...common}
          autosize
          minRows={2}
          placeholder={hints.placeholder}
          {...form.getInputProps(path)}
        />
      );
    case 'color':
      return <ColorInput {...common} format="hexa" {...form.getInputProps(path)} />;
    case 'asset': {
      const props = form.getInputProps(path);
      return (
        <AssetField
          {...common}
          error={props.error as ReactNode}
          accept={hints.accept ?? []}
          value={typeof props.value === 'string' ? props.value : ''}
          onChange={(value) => {
            form.setFieldValue(path, value);
          }}
        />
      );
    }
    default:
      return (
        <TextInput {...common} placeholder={hints?.placeholder} {...form.getInputProps(path)} />
      );
  }
}

function NumberFieldInput({ field, name, path, form, disabled }: FieldProps<NumberField>) {
  const label = field.title ?? name;
  const hints = field['x-overly'];
  const unit = hints?.unit;
  const common = { label, description: field.description, disabled };
  if (field.enum !== undefined) {
    const props = form.getInputProps(path);
    return (
      <Select
        {...common}
        data={field.enum.map((value, index) => ({
          value: String(value),
          label: hints?.enumLabels?.[index] ?? String(value),
        }))}
        allowDeselect={false}
        error={props.error as ReactNode}
        value={props.value === undefined ? null : String(props.value)}
        onChange={(value) => {
          if (value !== null) form.setFieldValue(path, Number(value));
        }}
      />
    );
  }
  const step = field.multipleOf ?? (field.type === 'integer' ? 1 : undefined);
  if (hints?.widget === 'slider' && field.minimum !== undefined && field.maximum !== undefined) {
    const props = form.getInputProps(path);
    return (
      <Input.Wrapper {...common} error={props.error as ReactNode}>
        <Slider
          mt="xs"
          min={field.minimum}
          max={field.maximum}
          {...(step === undefined ? {} : { step })}
          disabled={disabled}
          label={(value) => `${String(value)}${unit ?? ''}`}
          thumbLabel={label}
          {...props}
        />
      </Input.Wrapper>
    );
  }
  return (
    <NumberInput
      {...common}
      {...(field.minimum === undefined ? {} : { min: field.minimum })}
      {...(field.maximum === undefined ? {} : { max: field.maximum })}
      {...(step === undefined ? {} : { step })}
      allowDecimal={field.type === 'number'}
      {...(unit === undefined ? {} : { suffix: ` ${unit}` })}
      placeholder={hints?.placeholder}
      {...form.getInputProps(path)}
    />
  );
}

/** One input for one field of a plugin schema. */
export function FieldInput(props: FieldProps<Field>) {
  const { field, name, path, form, disabled } = props;
  switch (field.type) {
    case 'string':
      return <StringInput {...props} field={field} />;
    case 'number':
    case 'integer':
      return <NumberFieldInput {...props} field={field} />;
    case 'boolean':
      return (
        <Switch
          label={field.title ?? name}
          description={field.description}
          disabled={disabled}
          {...form.getInputProps(path, { type: 'checkbox' })}
        />
      );
    case 'object':
      return (
        <Fieldset legend={field.title ?? name} disabled={disabled}>
          <SchemaFields schema={field} form={form} path={path} disabled={disabled} />
        </Fieldset>
      );
    case 'array':
      return <ArrayField field={field} name={name} path={path} form={form} disabled={disabled} />;
  }
}

/**
 * The inputs of a plugin's settings schema (ADR 0013), bound to a Mantine form at `path`.
 * Fields keep the order of the schema's properties.
 */
export function SchemaFields({
  schema,
  form,
  path,
  disabled = false,
}: {
  schema: ObjectField;
  form: SchemaForm;
  path: string;
  disabled?: boolean;
}) {
  return (
    <Stack gap="sm">
      {Object.entries(schema.properties).map(([key, field]) => (
        <FieldInput
          key={key}
          field={field}
          name={key}
          path={`${path}.${key}`}
          form={form}
          disabled={disabled}
        />
      ))}
    </Stack>
  );
}
