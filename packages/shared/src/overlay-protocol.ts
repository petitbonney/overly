import { z } from 'zod';

import { WidgetIdSchema } from './ids.js';

// Messages on the overlay WebSocket, /o/<widgetId>/ws (ADR 0014).

/** Close code: the widget doesn't exist or was deleted. The SDK stops reconnecting. */
export const OVERLAY_CLOSE_NOT_FOUND = 4404;

const DeliveryId = z.string().min(1).max(64);
const Settings = z.record(z.string(), z.unknown());

export const OverlayServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    widget: z.object({ id: WidgetIdSchema, name: z.string(), type: z.string() }),
    active: z.boolean(),
    settings: Settings,
  }),
  z.object({ type: z.literal('settings'), settings: Settings }),
  z.object({ type: z.literal('widget'), name: z.string(), active: z.boolean() }),
  z.object({ type: z.literal('action'), id: DeliveryId, name: z.string(), params: z.unknown() }),
  z.object({ type: z.literal('message'), name: z.string(), payload: z.unknown() }),
]);
export type OverlayServerMessage = z.infer<typeof OverlayServerMessageSchema>;

export const OverlayClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('actionDone'), id: DeliveryId, result: z.unknown().optional() }),
  z.object({ type: z.literal('actionFailed'), id: DeliveryId, error: z.string().max(500) }),
]);
export type OverlayClientMessage = z.infer<typeof OverlayClientMessageSchema>;
