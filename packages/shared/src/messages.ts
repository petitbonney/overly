import { z } from 'zod';

/** WebSocket close code sent to every client when the server shuts down ("going away"). */
export const WS_CLOSE_SHUTDOWN = 1001;

export const HelloMessageSchema = z.object({ type: z.literal('hello'), version: z.string() });

/** Messages the server sends on `/ws`. */
export const ServerMessageSchema = z.discriminatedUnion('type', [HelloMessageSchema]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
