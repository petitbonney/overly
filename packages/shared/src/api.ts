import { z } from 'zod';

export const HealthResponseSchema = z.object({ status: z.literal('ok'), version: z.string() });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const SessionResponseSchema = z.object({ authenticated: z.literal(true) });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const ApiErrorBodySchema = z.object({ error: z.string() });
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export type ApiErrorCode = 'forbidden_host' | 'forbidden_origin' | 'no_session' | 'not_found';
