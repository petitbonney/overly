import { z } from 'zod';

/** Any value that survives `JSON.stringify` and `JSON.parse` unchanged. */
export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;
