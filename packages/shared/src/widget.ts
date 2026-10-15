import { z } from 'zod';

import { SemverSchema, WidgetIdSchema } from './ids.js';
import { JsonValueSchema } from './json.js';
import { WidgetTypeRefSchema } from './plugin/manifest.js';

export const WIDGET_SCHEMA_VERSION = 1;

/** `<data>/widgets/<id>.json`: one configured widget. */
export const WidgetDocumentSchema = z.object({
  schemaVersion: z.literal(WIDGET_SCHEMA_VERSION),
  id: WidgetIdSchema,
  type: WidgetTypeRefSchema,
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  /** The plugin version that last wrote `settings`, for migrations. */
  pluginVersion: SemverSchema,
  settings: z.record(z.string(), z.unknown()),
  /** Owned by the plugin backend. */
  state: JsonValueSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type WidgetDocument = z.infer<typeof WidgetDocumentSchema>;

export const WIDGET_PROBLEM_CODES = [
  'unreadable',
  'unsupported_version',
  'plugin_missing',
  'plugin_broken',
  'type_missing',
  'settings_invalid',
  'newer_plugin_version',
] as const;
export const WidgetProblemCodeSchema = z.enum(WIDGET_PROBLEM_CODES);
export type WidgetProblemCode = z.infer<typeof WidgetProblemCodeSchema>;

export const WidgetProblemSchema = z.object({
  code: WidgetProblemCodeSchema,
  message: z.string(),
});
export type WidgetProblem = z.infer<typeof WidgetProblemSchema>;

const Count = z.int().min(0);

/** What is happening to a widget right now: connected overlays and its action queue. */
export const WidgetRuntimeSchema = z.object({
  overlays: z.object({ live: Count, preview: Count }),
  queue: z.object({ pending: Count, running: z.string().nullable() }),
});
export type WidgetRuntime = z.infer<typeof WidgetRuntimeSchema>;

export const ACTION_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export const ActionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = z.infer<typeof ActionStatusSchema>;

/** `no_overlay`: the action went to the overlay, but none was connected. */
export const ACTION_WARNINGS = ['no_overlay'] as const;
export const ActionWarningSchema = z.enum(ACTION_WARNINGS);
export type ActionWarning = z.infer<typeof ActionWarningSchema>;
