import { z } from 'zod';

import { WidgetIdSchema } from './ids.js';
import { JsonValueSchema } from './json.js';

// Messages between the server (host) and a plugin backend (ADR 0015). Built-in backends run
// in-process behind a channel that JSON-clones every message; third-party backends will run in a
// child process (Phase 8) with the same messages.

/** The most state a backend may store per widget, serialized. */
export const MAX_STATE_BYTES = 1_048_576;

const Id = z.string().min(1).max(64);
const Settings = z.record(z.string(), z.unknown());

export const HostToBackendMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    widgetId: WidgetIdSchema,
    widgetType: z.string(),
    widget: z.object({ id: WidgetIdSchema, name: z.string() }),
    settings: Settings,
    state: JsonValueSchema,
  }),
  z.object({ type: z.literal('settings'), widgetId: WidgetIdSchema, settings: Settings }),
  z.object({
    type: z.literal('action'),
    widgetId: WidgetIdSchema,
    callId: Id,
    actionId: Id,
    name: z.string(),
    params: z.unknown(),
  }),
  z.object({
    type: z.literal('overlayConnected'),
    widgetId: WidgetIdSchema,
    overlayId: Id,
    preview: z.boolean(),
  }),
  z.object({
    type: z.literal('overlayActionResult'),
    widgetId: WidgetIdSchema,
    requestId: Id,
    ok: z.boolean(),
    delivered: z.boolean().optional(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({
    type: z.literal('migrate'),
    requestId: Id,
    widgetType: z.string(),
    settings: Settings,
    from: z.string(),
    to: z.string(),
  }),
  z.object({ type: z.literal('stop'), widgetId: WidgetIdSchema }),
]);
export type HostToBackendMessage = z.infer<typeof HostToBackendMessageSchema>;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export const BackendToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    widgets: z.record(
      z.string(),
      z.object({ actions: z.array(z.string()), migrates: z.boolean() }),
    ),
  }),
  z.object({
    type: z.literal('actionResult'),
    widgetId: WidgetIdSchema,
    callId: Id,
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ type: z.literal('setState'), widgetId: WidgetIdSchema, state: JsonValueSchema }),
  z.object({
    type: z.literal('emitToOverlay'),
    widgetId: WidgetIdSchema,
    name: z.string(),
    payload: z.unknown(),
    overlayId: Id.optional(),
  }),
  z.object({
    type: z.literal('overlayAction'),
    widgetId: WidgetIdSchema,
    requestId: Id,
    callId: Id.optional(),
    name: z.string(),
    params: z.unknown(),
    timeoutMs: z.int().positive().optional(),
  }),
  z.object({
    type: z.literal('emitEvent'),
    widgetId: WidgetIdSchema,
    name: z.string(),
    payload: z.unknown(),
  }),
  z.object({
    type: z.literal('log'),
    widgetId: WidgetIdSchema.optional(),
    level: z.enum(LOG_LEVELS),
    msg: z.string(),
    data: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    type: z.literal('migrateResult'),
    requestId: Id,
    ok: z.boolean(),
    settings: Settings.optional(),
    error: z.string().optional(),
  }),
]);
export type BackendToHostMessage = z.infer<typeof BackendToHostMessageSchema>;

/**
 * One end of a message channel. The receiving side parses what it gets with the schemas above,
 * so `onMessage` hands over `unknown`.
 */
export interface ChannelEnd {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  close(): void;
}
