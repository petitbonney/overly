import { ApiErrorBodySchema } from '@overly/shared';
import type { z } from 'zod';

/** A non-2xx answer from the Overly server. `code` is the server's `error` field when present. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(`Overly server answered ${String(status)}${code === undefined ? '' : ` (${code})`}`);
    this.name = 'ApiError';
  }
}

/** GET a same-origin API path and validate the JSON body. */
export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<T> {
  const response = await fetchImpl(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiErrorBodySchema.safeParse(body);
    throw new ApiError(response.status, parsed.success ? parsed.data.error : undefined);
  }
  return schema.parse(body);
}
