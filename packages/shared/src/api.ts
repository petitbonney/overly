import { z } from 'zod';

import { AssetSchema } from './assets.js';
import { ACTION_PRIORITY } from './limits.js';
import { WidgetTypeRefSchema } from './plugin/manifest.js';
import { ObjectFieldSchema } from './schema/subset.js';
import { WidgetProblemSchema, WidgetRuntimeSchema } from './widget.js';

export const HealthResponseSchema = z.object({ status: z.literal('ok'), version: z.string() });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const SessionResponseSchema = z.object({ authenticated: z.literal(true) });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const IssueSchema = z.object({ path: z.string(), message: z.string() });
export type Issue = z.infer<typeof IssueSchema>;

export const ApiErrorBodySchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  issues: z.array(IssueSchema).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export type ApiErrorCode =
  | 'forbidden_host'
  | 'forbidden_origin'
  | 'no_session'
  | 'not_found'
  | 'invalid_body'
  | 'widget_not_found'
  | 'widget_type_not_found'
  | 'widget_broken'
  | 'widget_disabled'
  | 'action_not_found'
  | 'invalid_params'
  | 'invalid_settings'
  | 'queue_full'
  | 'asset_not_found'
  | 'asset_too_large'
  | 'unsupported_asset_type';

const Settings = z.record(z.string(), z.unknown());

export const OverlaySizeSchema = z.object({ width: z.int(), height: z.int() });
export type OverlaySize = z.infer<typeof OverlaySizeSchema>;

export const ActionInfoSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  params: ObjectFieldSchema,
  sample: Settings,
  queued: z.boolean(),
});
export type ActionInfo = z.infer<typeof ActionInfoSchema>;

export const EventInfoSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string().optional(),
  payload: ObjectFieldSchema,
  sample: Settings,
});
export type EventInfo = z.infer<typeof EventInfoSchema>;

export const WidgetTypeInfoSchema = z.object({
  /** `<pluginId>:<type>` */
  type: z.string(),
  pluginId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  iconUrl: z.string().nullable(),
  settings: ObjectFieldSchema,
  overlay: OverlaySizeSchema.nullable(),
  actions: z.array(ActionInfoSchema),
  events: z.array(EventInfoSchema),
});
export type WidgetTypeInfo = z.infer<typeof WidgetTypeInfoSchema>;

export const PluginInfoSchema = z.object({
  /** `null` when a broken manifest has no readable ID. */
  id: z.string().nullable(),
  /** The plugin's folder name, to tell broken plugins apart. */
  folder: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  description: z.string().optional(),
  author: z.string().optional(),
  iconUrl: z.string().nullable(),
  status: z.enum(['ok', 'broken']),
  errors: z.array(z.string()),
  widgetTypes: z.array(WidgetTypeInfoSchema),
});
export type PluginInfo = z.infer<typeof PluginInfoSchema>;

export const PluginsResponseSchema = z.object({ plugins: z.array(PluginInfoSchema) });
export type PluginsResponse = z.infer<typeof PluginsResponseSchema>;

export const WidgetSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** The widget type's name, or `null` when the type isn't available. */
  typeName: z.string().nullable(),
  iconUrl: z.string().nullable(),
  enabled: z.boolean(),
  status: z.enum(['ok', 'broken']),
  problems: z.array(WidgetProblemSchema),
});
export type WidgetSummary = z.infer<typeof WidgetSummarySchema>;

export const WidgetsResponseSchema = z.object({ widgets: z.array(WidgetSummarySchema) });
export type WidgetsResponse = z.infer<typeof WidgetsResponseSchema>;

export const WidgetDetailSchema = WidgetSummarySchema.extend({
  settings: Settings,
  /** `http://127.0.0.1:<port>/o/<id>`, or `null` for a type without an overlay. */
  overlayUrl: z.string().nullable(),
  overlay: OverlaySizeSchema.nullable(),
  runtime: WidgetRuntimeSchema,
});
export type WidgetDetail = z.infer<typeof WidgetDetailSchema>;

const WidgetNameSchema = z.string().trim().min(1).max(100);

export const CreateWidgetBodySchema = z.strictObject({
  type: WidgetTypeRefSchema,
  name: WidgetNameSchema.optional(),
});
export type CreateWidgetBody = z.infer<typeof CreateWidgetBodySchema>;

export const UpdateWidgetBodySchema = z
  .strictObject({
    name: WidgetNameSchema.optional(),
    enabled: z.boolean().optional(),
    /** Replaces the whole settings object. */
    settings: Settings.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export type UpdateWidgetBody = z.infer<typeof UpdateWidgetBodySchema>;

export const RunActionBodySchema = z.strictObject({
  params: Settings.default(() => ({})),
  priority: z
    .int()
    .min(ACTION_PRIORITY.min)
    .max(ACTION_PRIORITY.max)
    .default(ACTION_PRIORITY.default),
});
export type RunActionBody = z.infer<typeof RunActionBodySchema>;

export const RunActionResponseSchema = z.object({
  actionId: z.string(),
  status: z.enum(['queued', 'running']),
});
export type RunActionResponse = z.infer<typeof RunActionResponseSchema>;

export const AssetsResponseSchema = z.object({ assets: z.array(AssetSchema) });
export type AssetsResponse = z.infer<typeof AssetsResponseSchema>;
