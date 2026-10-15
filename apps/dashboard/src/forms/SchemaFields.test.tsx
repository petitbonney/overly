import { useForm } from '@mantine/form';
import type { ObjectField } from '@overly/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api.js';
import { renderWithProviders } from '../test/render.js';
import { SchemaFields } from './SchemaFields.js';
import { validateWithSchema } from './validate.js';

const everything: ObjectField = {
  type: 'object',
  properties: {
    position: {
      type: 'string',
      title: 'Position',
      enum: ['top', 'bottom'],
      default: 'bottom',
      'x-overly': { enumLabels: ['Top', 'Bottom'] },
    },
    fontFamily: {
      type: 'string',
      title: 'Font',
      description: 'A CSS font list',
      default: 'system-ui',
    },
    template: {
      type: 'string',
      title: 'Template',
      default: '{{title}}',
      'x-overly': { widget: 'textarea' },
    },
    color: {
      type: 'string',
      title: 'Text color',
      default: '#ffffff',
      'x-overly': { widget: 'color' },
    },
    image: {
      type: 'string',
      title: 'Image',
      default: '',
      'x-overly': { widget: 'asset', accept: ['image'] },
    },
    fontSize: {
      type: 'integer',
      title: 'Font size',
      default: 48,
      minimum: 12,
      'x-overly': { unit: 'px' },
    },
    volume: {
      type: 'integer',
      title: 'Volume',
      default: 80,
      minimum: 0,
      maximum: 100,
      'x-overly': { widget: 'slider', unit: '%' },
    },
    loop: { type: 'boolean', title: 'Loop', default: false },
    style: {
      type: 'object',
      title: 'Style',
      properties: { shadow: { type: 'boolean', title: 'Shadow', default: true } },
    },
    untitled: { type: 'string', default: '' },
  },
};

function Harness({
  schema,
  initial,
  disabled = false,
  onSubmit = vi.fn(),
}: {
  schema: ObjectField;
  initial: Record<string, unknown>;
  disabled?: boolean;
  onSubmit?: (values: Record<string, unknown>) => void;
}) {
  const form = useForm<Record<string, unknown>>({
    mode: 'controlled',
    initialValues: { settings: initial },
    validate: (values) => validateWithSchema(schema, values['settings'], 'settings'),
  });
  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <SchemaFields schema={schema} form={form} path="settings" disabled={disabled} />
      <button type="submit">Submit</button>
      <output data-testid="values">{JSON.stringify(form.getValues())}</output>
    </form>
  );
}

function values(): unknown {
  return JSON.parse(screen.getByTestId('values').textContent || '{}');
}

const defaults = {
  position: 'bottom',
  fontFamily: 'system-ui',
  template: '{{title}}',
  color: '#ffffff',
  image: '',
  fontSize: 48,
  volume: 80,
  loop: false,
  style: { shadow: true },
  untitled: '',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SchemaFields', () => {
  it('renders each field type with its label and description', () => {
    mockApi(() => ({ body: { assets: [] } }));
    renderWithProviders(<Harness schema={everything} initial={defaults} />);
    expect(screen.getByRole('combobox', { name: 'Position' })).toHaveValue('Bottom');
    expect(screen.getByLabelText('Font')).toHaveValue('system-ui');
    expect(screen.getByText('A CSS font list')).toBeInTheDocument();
    expect(screen.getByLabelText('Template').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Text color')).toHaveValue('#ffffff');
    expect(screen.getByText('Image')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose…' })).toBeInTheDocument();
    expect(screen.getByLabelText('Font size')).toHaveValue('48 px');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuenow', '80');
    expect(screen.getByRole('switch', { name: 'Loop' })).not.toBeChecked();
    expect(
      within(screen.getByRole('group', { name: 'Style' })).getByRole('switch', { name: 'Shadow' }),
    ).toBeChecked();
    expect(screen.getByLabelText('untitled')).toHaveValue('');
  });

  it('edits values', async () => {
    mockApi(() => ({ body: { assets: [] } }));
    const user = userEvent.setup();
    renderWithProviders(<Harness schema={everything} initial={defaults} />);
    await user.clear(screen.getByLabelText('Font'));
    await user.type(screen.getByLabelText('Font'), 'Georgia');
    await user.click(screen.getByRole('switch', { name: 'Loop' }));
    expect(values()).toMatchObject({ settings: { fontFamily: 'Georgia', loop: true } });
  });

  it('shows validation errors at the field', async () => {
    const schema: ObjectField = {
      type: 'object',
      properties: { step: { type: 'integer', title: 'Step', minimum: 1, default: 1 } },
    };
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<Harness schema={schema} initial={{ step: 0 }} onSubmit={onSubmit} />);
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText(/expected number to be >=1/)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('adds and removes array items with their defaults', async () => {
    const schema: ObjectField = {
      type: 'object',
      properties: {
        segments: {
          type: 'array',
          title: 'Segments',
          default: [],
          maxItems: 2,
          items: {
            type: 'object',
            properties: { label: { type: 'string', title: 'Label', default: 'Segment' } },
          },
        },
      },
    };
    const user = userEvent.setup();
    renderWithProviders(<Harness schema={schema} initial={{ segments: [] }} />);
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByLabelText('Label')).toHaveValue('Segment');
    expect(values()).toEqual({ settings: { segments: [{ label: 'Segment' }] } });
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Remove item 1' }));
    await waitFor(() => {
      expect(values()).toEqual({ settings: { segments: [{ label: 'Segment' }] } });
    });
  });

  it('disables every input when disabled', () => {
    mockApi(() => ({ body: { assets: [] } }));
    renderWithProviders(<Harness schema={everything} initial={defaults} disabled />);
    expect(screen.getByLabelText('Font')).toBeDisabled();
    expect(screen.getByLabelText('Font size')).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Loop' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Choose…' })).toBeDisabled();
  });
});
