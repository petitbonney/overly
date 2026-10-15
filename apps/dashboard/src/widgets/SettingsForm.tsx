import { Button, Card, Group, Stack, Text, TextInput, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import type { WidgetDetail, WidgetTypeInfo } from '@overly/shared';
import { useEffect } from 'react';

import { ApiError } from '../api/client.js';
import { useUpdateWidget } from '../api/hooks.js';
import { SchemaFields } from '../forms/SchemaFields.js';
import { validateWithSchema } from '../forms/validate.js';

interface FormValues extends Record<string, unknown> {
  name: string;
  settings: Record<string, unknown>;
}

function validate(type: WidgetTypeInfo, values: Record<string, unknown>): Record<string, string> {
  const name = typeof values['name'] === 'string' ? values['name'].trim() : '';
  return {
    ...(name.length === 0 ? { name: 'Give the widget a name' } : {}),
    ...(name.length > 100 ? { name: 'At most 100 characters' } : {}),
    ...validateWithSchema(type.settings, values['settings'], 'settings'),
  };
}

/**
 * The widget's name and settings in one form. Save sends both; Discard restores the saved
 * values. While the form has valid unsaved changes, `onDraft` gets them (for the preview).
 */
export function SettingsForm({
  widget,
  type,
  readOnly,
  onDraft,
  onGone,
}: {
  widget: WidgetDetail;
  type: WidgetTypeInfo;
  readOnly: boolean;
  onDraft: (draft: Record<string, unknown> | null) => void;
  onGone: () => void;
}) {
  const update = useUpdateWidget(widget.id);
  const form = useForm<Record<string, unknown>>({
    mode: 'controlled',
    initialValues: { name: widget.name, settings: widget.settings } satisfies FormValues,
    validate: (values) => validate(type, values),
    // Save is disabled while the form is invalid, so errors must show as the user types.
    validateInputOnChange: true,
  });

  const values = form.getValues();
  const dirty = form.isDirty();
  const valid = Object.keys(validate(type, values)).length === 0;
  const settingsKey = JSON.stringify(values['settings']);

  useEffect(() => {
    onDraft(dirty && valid ? (JSON.parse(settingsKey) as Record<string, unknown>) : null);
  }, [dirty, valid, settingsKey, onDraft]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  // Saved elsewhere (another tab): take the new values unless there are unsaved changes here.
  // Saved settings that fail the schema (settings_invalid) show each issue at its field.
  const savedKey = JSON.stringify({ name: widget.name, settings: widget.settings });
  const savedInvalid = widget.problems.some((problem) => problem.code === 'settings_invalid');
  useEffect(() => {
    if (form.isDirty()) return;
    const saved = JSON.parse(savedKey) as FormValues;
    form.setInitialValues(saved);
    form.setValues(saved);
    if (savedInvalid) form.validate();
    // `form` is stable; only new saved values matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, savedInvalid]);

  const submit = form.onSubmit((submitted) => {
    const body = {
      name: String(submitted['name']).trim(),
      settings: submitted['settings'] as Record<string, unknown>,
    };
    update.mutate(body, {
      onSuccess: (saved) => {
        const next: FormValues = { name: saved.name, settings: saved.settings };
        form.setInitialValues(next);
        form.setValues(next);
      },
      onError: (error) => {
        if (error instanceof ApiError && error.code === 'widget_not_found') {
          onGone();
          return;
        }
        if (error instanceof ApiError && error.issues !== undefined) {
          form.setErrors(
            Object.fromEntries(
              error.issues.map((issue) => [
                issue.path === '' ? 'settings' : `settings.${issue.path}`,
                issue.message,
              ]),
            ),
          );
        }
        notifications.show({
          title: 'The settings were not saved',
          message: error.message,
          color: 'red',
        });
      },
    });
  });

  return (
    <Card withBorder>
      <form onSubmit={submit}>
        <Stack gap="md">
          <Title order={3} size="h5">
            Settings
          </Title>
          <TextInput label="Name" disabled={readOnly} {...form.getInputProps('name')} />
          <SchemaFields schema={type.settings} form={form} path="settings" disabled={readOnly} />
          {!readOnly && (
            <Group justify="space-between">
              <Text size="sm" c={dirty ? 'orange' : 'dimmed'}>
                {dirty ? 'Unsaved changes' : ''}
              </Text>
              <Group gap="xs">
                <Button
                  variant="default"
                  disabled={!dirty || update.isPending}
                  onClick={() => {
                    form.reset();
                  }}
                >
                  Discard changes
                </Button>
                <Button type="submit" disabled={!dirty || !valid} loading={update.isPending}>
                  Save
                </Button>
              </Group>
            </Group>
          )}
        </Stack>
      </form>
    </Card>
  );
}
