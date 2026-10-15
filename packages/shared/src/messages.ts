import { z } from 'zod';

import { WidgetIdSchema } from './ids.js';
import { ActionStatusSchema, ActionWarningSchema, WidgetRuntimeSchema } from './widget.js';

/** WebSocket close code sent to every client when the server shuts down ("going away"). */
export const WS_CLOSE_SHUTDOWN = 1001;

export const HelloMessageSchema = z.object({ type: z.literal('hello'), version: z.string() });

/** A widget was created, changed or deleted: refetch the widget list (and that widget). */
export const WidgetsChangedMessageSchema = z.object({
  type: z.literal('widgets.changed'),
  widgetId: WidgetIdSchema.optional(),
});

export const WidgetRuntimeMessageSchema = z.object({
  type: z.literal('widget.runtime'),
  widgetId: WidgetIdSchema,
  runtime: WidgetRuntimeSchema,
});

export const WidgetActionMessageSchema = z.object({
  type: z.literal('widget.action'),
  widgetId: WidgetIdSchema,
  actionId: z.string(),
  action: z.string(),
  status: ActionStatusSchema,
  warnings: z.array(ActionWarningSchema).default(() => []),
  error: z.string().optional(),
});
export type WidgetActionMessage = z.infer<typeof WidgetActionMessageSchema>;

/** Messages the server sends on `/ws`. */
export const ServerMessageSchema = z.discriminatedUnion('type', [
  HelloMessageSchema,
  WidgetsChangedMessageSchema,
  WidgetRuntimeMessageSchema,
  WidgetActionMessageSchema,
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
