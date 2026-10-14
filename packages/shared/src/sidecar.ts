import { z } from 'zod';

import { PortSchema } from './settings.js';

// JSON-RPC 2.0 between the desktop shell and the Node sidecar, one message per line on stdio.
// See docs/sidecar-protocol.md.

const JsonRpcId = z.union([z.number(), z.string()]);

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcId,
  method: z.string(),
  params: z.unknown().optional(),
});

export const JsonRpcNotificationSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string(),
  params: z.unknown().optional(),
});

export const JsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: JsonRpcId,
  result: z.unknown(),
});

export const JsonRpcFailureSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([JsonRpcId, z.null()]),
  error: z.object({
    code: z.int(),
    message: z.string(),
    data: z.unknown().optional(),
  }),
});

/** Order matters: a request also matches the notification shape once its id is stripped. */
export const JsonRpcMessageSchema = z.union([
  JsonRpcRequestSchema,
  JsonRpcNotificationSchema,
  JsonRpcSuccessSchema,
  JsonRpcFailureSchema,
]);

export type JsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;
export type JsonRpcNotification = z.infer<typeof JsonRpcNotificationSchema>;
export type JsonRpcSuccess = z.infer<typeof JsonRpcSuccessSchema>;
export type JsonRpcFailure = z.infer<typeof JsonRpcFailureSchema>;
export type JsonRpcMessage = z.infer<typeof JsonRpcMessageSchema>;

export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export const SidecarMethod = {
  /** Notification, server → shell: the server is listening. */
  ready: 'ready',
  /** Notification, server → shell: the server can't start and won't be restarted. */
  fatal: 'fatal',
  /** Request, shell → server: a dashboard URL with a fresh one-time token. */
  getDashboardUrl: 'getDashboardUrl',
  /** Request, shell → server: shut down gracefully, then exit. */
  shutdown: 'shutdown',
} as const;

export const FATAL_CODES = [
  'port_in_use',
  'port_unavailable',
  'config_unsupported',
  'startup_failed',
] as const;

export const FatalCodeSchema = z.enum(FATAL_CODES);
export type FatalCode = z.infer<typeof FatalCodeSchema>;

export const ReadyParamsSchema = z.object({ port: PortSchema, version: z.string() });
export type ReadyParams = z.infer<typeof ReadyParamsSchema>;

export const FatalParamsSchema = z.object({ code: FatalCodeSchema, message: z.string() });
export type FatalParams = z.infer<typeof FatalParamsSchema>;

export const DashboardUrlResultSchema = z.object({ url: z.url() });
export type DashboardUrlResult = z.infer<typeof DashboardUrlResultSchema>;
