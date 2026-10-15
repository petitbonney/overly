import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import {
  formatIssues,
  WIDGET_SCHEMA_VERSION,
  type WidgetDocument,
  WidgetDocumentSchema,
} from '@overly/shared';
import type pino from 'pino';

import { SerializedWriter } from '../storage/serialized-writer.js';

export type StoredWidget =
  | { kind: 'document'; doc: WidgetDocument }
  | { kind: 'unreadable'; id: string; code: 'unreadable' | 'unsupported_version'; reason: string };

const WIDGET_FILE = /^([a-z0-9]{12})\.json$/;

function serialize(doc: WidgetDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one widget file. A file that can't be used is reported, never rewritten. */
function parseWidgetFile(id: string, text: string): StoredWidget {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'unreadable', id, code: 'unreadable', reason: `Invalid JSON: ${message}` };
  }
  if (
    isRecord(json) &&
    typeof json['schemaVersion'] === 'number' &&
    json['schemaVersion'] > WIDGET_SCHEMA_VERSION
  ) {
    return {
      kind: 'unreadable',
      id,
      code: 'unsupported_version',
      reason: 'This widget was saved by a newer version of Overly.',
    };
  }
  const result = WidgetDocumentSchema.safeParse(json);
  if (!result.success) {
    const reason = formatIssues(result.error)
      .map(({ path, message }) => (path === '' ? message : `${path}: ${message}`))
      .join('; ');
    return { kind: 'unreadable', id, code: 'unreadable', reason };
  }
  if (result.data.id !== id) {
    return {
      kind: 'unreadable',
      id,
      code: 'unreadable',
      reason: `The id field (${result.data.id}) doesn't match the file name.`,
    };
  }
  return { kind: 'document', doc: result.data };
}

/**
 * One JSON document per widget in `<data>/widgets/<id>.json`, kept in memory. Changes apply in
 * memory first, then each widget's file is written atomically, one write at a time.
 */
export class WidgetStore {
  readonly #dir: string;
  readonly #now: () => Date;
  readonly #entries = new Map<string, StoredWidget>();
  readonly #writers = new Map<string, SerializedWriter>();

  private constructor(dir: string, now: () => Date) {
    this.#dir = dir;
    this.#now = now;
  }

  static async open(options: {
    dir: string;
    logger: pino.Logger;
    now?: () => Date;
  }): Promise<WidgetStore> {
    const store = new WidgetStore(options.dir, options.now ?? (() => new Date()));
    await mkdir(options.dir, { recursive: true });
    const names = (await readdir(options.dir)).sort();
    for (const name of names) {
      const id = WIDGET_FILE.exec(name)?.[1];
      if (id === undefined) continue;
      const entry = parseWidgetFile(id, await readFile(join(options.dir, name), 'utf8'));
      if (entry.kind === 'unreadable') {
        options.logger.warn({ widgetId: id, reason: entry.reason }, 'Widget file is unreadable');
      }
      store.#entries.set(id, entry);
    }
    return store;
  }

  list(): readonly StoredWidget[] {
    return [...this.#entries.values()];
  }

  get(id: string): StoredWidget | undefined {
    return this.#entries.get(id);
  }

  async create(doc: WidgetDocument): Promise<void> {
    const parsed = WidgetDocumentSchema.parse(doc);
    if (this.#entries.has(parsed.id)) throw new Error(`Widget ${parsed.id} already exists`);
    this.#entries.set(parsed.id, { kind: 'document', doc: parsed });
    await this.#writer(parsed.id).schedule(serialize(parsed));
  }

  /** Applies `fn`, sets `updatedAt`, validates, then writes. Throws if the result is invalid. */
  async update(id: string, fn: (doc: WidgetDocument) => WidgetDocument): Promise<WidgetDocument> {
    const entry = this.#entries.get(id);
    if (entry?.kind !== 'document') throw new Error(`Widget ${id} has no readable document`);
    const next = WidgetDocumentSchema.parse({
      ...fn(entry.doc),
      id,
      updatedAt: this.#now().toISOString(),
    });
    this.#entries.set(id, { kind: 'document', doc: next });
    await this.#writer(id).schedule(serialize(next));
    return next;
  }

  /** Forgets the widget, waits for its pending write, then removes its file. */
  async delete(id: string): Promise<void> {
    this.#entries.delete(id);
    const writer = this.#writers.get(id);
    this.#writers.delete(id);
    await writer?.flush();
    await rm(this.#path(id), { force: true });
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#writers.values()].map((writer) => writer.flush()));
  }

  #path(id: string): string {
    return join(this.#dir, `${id}.json`);
  }

  #writer(id: string): SerializedWriter {
    let writer = this.#writers.get(id);
    if (writer === undefined) {
      writer = new SerializedWriter(this.#path(id));
      this.#writers.set(id, writer);
    }
    return writer;
  }
}
