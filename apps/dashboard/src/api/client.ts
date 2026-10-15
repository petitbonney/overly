import { type Asset, AssetSchema, ApiErrorBodySchema, type Issue } from '@overly/shared';
import type { z } from 'zod';

/** A non-2xx answer from the Overly server. `code` is the server's `error` field when present. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    /** The server's explanation, when it gave one. */
    readonly detail?: string,
    /** Problems with the request, by field path. */
    readonly issues?: Issue[],
  ) {
    super(
      detail ?? `Overly server answered ${String(status)}${code === undefined ? '' : ` (${code})`}`,
    );
    this.name = 'ApiError';
  }
}

type Fetch = typeof fetch;

const defaultFetch: Fetch = (input, init) => fetch(input, init);

async function errorFrom(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = ApiErrorBodySchema.safeParse(body);
  if (!parsed.success) return new ApiError(response.status, undefined);
  const { error, message, issues } = parsed.data;
  return new ApiError(response.status, error, message, issues);
}

async function parseBody<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) throw await errorFrom(response);
  return schema.parse(await response.json());
}

/** GET a same-origin API path and validate the JSON body. */
export async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  fetchImpl: Fetch = defaultFetch,
): Promise<T> {
  const response = await fetchImpl(path, {
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  return parseBody(response, schema);
}

/** POST or PATCH a JSON body and validate the JSON answer. */
export async function apiSend<T>(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  fetchImpl: Fetch = defaultFetch,
): Promise<T> {
  const response = await fetchImpl(path, {
    method,
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseBody(response, schema);
}

/** DELETE a same-origin API path. */
export async function apiDelete(path: string, fetchImpl: Fetch = defaultFetch): Promise<void> {
  const response = await fetchImpl(path, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw await errorFrom(response);
}

/** Uploads a file to the asset library as the raw request body. */
export async function apiUpload(file: File, fetchImpl: Fetch = defaultFetch): Promise<Asset> {
  const response = await fetchImpl(`/api/assets?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json' },
    body: file,
  });
  return parseBody(response, AssetSchema);
}
