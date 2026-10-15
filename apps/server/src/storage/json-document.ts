import { readFile, rename } from 'node:fs/promises';

import type { z } from 'zod';

import { SerializedWriter } from './serialized-writer.js';

/** The part of a pino logger that documents use. */
export interface DocumentLogger {
  warn(obj: object, msg: string): void;
}

/** Key `n` upgrades a document from schema version `n` to `n + 1`. */
export type Migrations = Readonly<
  Record<number, (doc: Record<string, unknown>) => Record<string, unknown>>
>;

/** The file was written by a newer version of Overly. It is left untouched. */
export class DocumentVersionError extends Error {
  constructor(
    readonly path: string,
    readonly found: number,
    readonly supported: number,
  ) {
    super(
      `${path} has schema version ${String(found)}, but this version of Overly only supports up to ${String(supported)}.`,
    );
    this.name = 'DocumentVersionError';
  }
}

export interface JsonDocumentOptions<T> {
  path: string;
  schema: z.ZodType<T>;
  /** The schema version this build writes. */
  version: number;
  defaults: () => T;
  migrations?: Migrations;
  logger: DocumentLogger;
  /** Replaces the atomic file write, for tests. */
  write?: (path: string, data: string) => Promise<void>;
  now?: () => Date;
}

interface Loaded<T> {
  value: T;
  save: boolean;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON file with a schema version, validated on load and written atomically.
 * Writes are serialized: while one is in flight, only the newest pending value is kept.
 */
export class JsonDocument<T extends { schemaVersion: number }> {
  readonly #options: JsonDocumentOptions<T>;
  readonly #writer: SerializedWriter;
  #value: T;

  private constructor(options: JsonDocumentOptions<T>, value: T) {
    this.#options = options;
    this.#writer = new SerializedWriter(options.path, options.write);
    this.#value = value;
  }

  static async open<T extends { schemaVersion: number }>(
    options: JsonDocumentOptions<T>,
  ): Promise<JsonDocument<T>> {
    const { value, save } = await load(options);
    const doc = new JsonDocument(options, value);
    if (save) await doc.#writer.schedule(serialize(value));
    return doc;
  }

  get(): T {
    return this.#value;
  }

  /** Validates `next`, makes it the current value and schedules a write. Rejects if invalid. */
  set(next: T): Promise<void> {
    const parsed = this.#options.schema.safeParse(next);
    if (!parsed.success) return Promise.reject(parsed.error);
    this.#value = parsed.data;
    return this.#writer.schedule(serialize(parsed.data));
  }

  update(fn: (current: T) => T): Promise<void> {
    return this.set(fn(this.#value));
  }

  /** Resolves when every value set so far is on disk. */
  flush(): Promise<void> {
    return this.#writer.flush();
  }
}

async function load<T extends { schemaVersion: number }>(
  options: JsonDocumentOptions<T>,
): Promise<Loaded<T>> {
  const { path, schema, version, defaults, migrations = {} } = options;

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { value: defaults(), save: true };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return replaceCorrupt(options, 'invalid JSON');
  }
  if (!isRecord(parsed) || typeof parsed['schemaVersion'] !== 'number') {
    return replaceCorrupt(options, 'missing schemaVersion');
  }

  const found = parsed['schemaVersion'];
  if (found > version) throw new DocumentVersionError(path, found, version);

  let doc = parsed;
  for (let from = found; from < version; from++) {
    const migrate = migrations[from];
    if (migrate === undefined) {
      return replaceCorrupt(options, `no migration from version ${String(from)}`);
    }
    doc = { ...migrate(doc), schemaVersion: from + 1 };
  }

  const result = schema.safeParse(doc);
  if (!result.success) return replaceCorrupt(options, result.error.message);
  return { value: result.data, save: found !== version };
}

async function replaceCorrupt<T>(
  options: JsonDocumentOptions<T>,
  reason: string,
): Promise<Loaded<T>> {
  const now = (options.now ?? (() => new Date()))();
  // No colons in the name: Windows doesn't allow them in file names.
  const backup = `${options.path}.corrupt-${now.toISOString().replaceAll(':', '-')}`;
  await rename(options.path, backup);
  options.logger.warn(
    { path: options.path, backup, reason },
    'Replaced an unreadable document with defaults',
  );
  return { value: options.defaults(), save: true };
}
