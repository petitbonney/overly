import { expect, it } from 'vitest';

import { WidgetDocumentSchema, WidgetRuntimeSchema } from './widget.js';

const doc = {
  schemaVersion: 1,
  id: 'abcdefghij12',
  type: 'overly.alerts:alerts',
  name: 'Alerts',
  enabled: true,
  pluginVersion: '1.0.0',
  settings: { volume: 80 },
  state: null,
  createdAt: '2026-10-15T08:00:00.000Z',
  updatedAt: '2026-10-15T08:00:00.000Z',
};

it('accepts a widget document', () => {
  expect(WidgetDocumentSchema.parse(doc)).toEqual(doc);
});

it.each([
  ['a bad ID', { id: 'ABC' }],
  ['a blank name', { name: '   ' }],
  ['a type without a plugin', { type: 'alerts' }],
  ['a missing state', { state: undefined }],
  ['a non-JSON state', { state: { at: () => 1 } }],
  ['another schema version', { schemaVersion: 2 }],
  ['a bad date', { createdAt: 'yesterday' }],
])('rejects %s', (_name, change) => {
  expect(WidgetDocumentSchema.safeParse({ ...doc, ...change }).success).toBe(false);
});

it('trims widget names', () => {
  expect(WidgetDocumentSchema.parse({ ...doc, name: '  Alerts  ' }).name).toBe('Alerts');
});

it('describes the runtime of a widget', () => {
  const runtime = { overlays: { live: 1, preview: 0 }, queue: { pending: 2, running: 'show' } };
  expect(WidgetRuntimeSchema.parse(runtime)).toEqual(runtime);
  expect(
    WidgetRuntimeSchema.safeParse({ ...runtime, overlays: { live: -1, preview: 0 } }).success,
  ).toBe(false);
});
