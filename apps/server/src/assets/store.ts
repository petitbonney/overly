import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';

import {
  type Asset,
  type AssetKind,
  AssetSchema,
  assetTypeForName,
  MAX_ASSET_BYTES,
} from '@overly/shared';
import type pino from 'pino';
import { z } from 'zod';

import { JsonDocument } from '../storage/json-document.js';
import { randomId } from '../util/random-id.js';

export const ASSET_INDEX_FILE = 'index.json';

const AssetIndexSchema = z.object({
  schemaVersion: z.literal(1),
  assets: z.array(AssetSchema),
});
type AssetIndex = z.infer<typeof AssetIndexSchema>;

export type AssetErrorCode = 'asset_too_large' | 'unsupported_asset_type' | 'invalid_body';

export class AssetError extends Error {
  constructor(
    readonly status: 413 | 415 | 400,
    readonly code: AssetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AssetError';
  }
}

/** The name shown in the dashboard: the last segment of whatever path the browser sent. */
function displayName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? '').trim();
}

/**
 * Pipes the upload through `meter` into `path`. On an error the request is only unpiped, never
 * destroyed: destroying it would kill the connection before the error response goes out, and
 * Node discards the rest of an unread request body by itself.
 */
function writeUpload(body: Readable, meter: Transform, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const file = createWriteStream(path);
    let failed = false;
    const fail = (error: unknown): void => {
      if (failed) return;
      failed = true;
      body.unpipe(meter);
      meter.destroy();
      file.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    meter.once('error', fail);
    file.once('error', fail);
    body.once('error', fail);
    // 'close' comes after the file descriptor is closed, so the file can be renamed (Windows).
    file.once('close', () => {
      if (!failed) resolve();
    });
    body.pipe(meter).pipe(file);
  });
}

/**
 * Images, sounds, videos and fonts uploaded from the dashboard: `<dir>/<id><ext>` plus an index.
 * Files with the same content are stored once.
 */
export class AssetStore {
  readonly dir: string;
  readonly #index: JsonDocument<AssetIndex>;
  readonly #maxBytes: number;
  readonly #now: () => Date;

  private constructor(
    dir: string,
    index: JsonDocument<AssetIndex>,
    maxBytes: number,
    now: () => Date,
  ) {
    this.dir = dir;
    this.#index = index;
    this.#maxBytes = maxBytes;
    this.#now = now;
  }

  static async open(options: {
    dir: string;
    logger: pino.Logger;
    maxBytes?: number;
    now?: () => Date;
  }): Promise<AssetStore> {
    await mkdir(options.dir, { recursive: true });
    const index = await JsonDocument.open({
      path: join(options.dir, ASSET_INDEX_FILE),
      schema: AssetIndexSchema,
      version: 1,
      defaults: (): AssetIndex => ({ schemaVersion: 1, assets: [] }),
      logger: options.logger,
    });
    return new AssetStore(
      options.dir,
      index,
      options.maxBytes ?? MAX_ASSET_BYTES,
      options.now ?? (() => new Date()),
    );
  }

  /** Newest first, optionally only some kinds. */
  list(kinds?: readonly AssetKind[]): Asset[] {
    return this.#index
      .get()
      .assets.filter((asset) => kinds === undefined || kinds.includes(asset.kind))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  get(id: string): Asset | undefined {
    return this.#index.get().assets.find((asset) => asset.id === id);
  }

  /** The asset's file name inside `dir`. */
  fileName(asset: Asset): string {
    return `${asset.id}${assetTypeForName(asset.name)?.ext ?? ''}`;
  }

  /**
   * Streams an upload to a temporary file while counting and hashing it, then keeps it, or
   * returns the asset that already has the same content. Throws `AssetError` for a bad name, an
   * unsupported type or a file over the size limit; the temporary file is always removed.
   */
  async add(name: string, body: Readable): Promise<{ asset: Asset; created: boolean }> {
    const shown = displayName(name);
    if (shown.length === 0 || shown.length > 200) {
      body.resume();
      throw new AssetError(400, 'invalid_body', 'The file name must have 1 to 200 characters.');
    }
    const type = assetTypeForName(shown);
    if (type === undefined) {
      body.resume();
      throw new AssetError(415, 'unsupported_asset_type', `${shown} is not a supported file type.`);
    }

    const temp = join(this.dir, `${randomId()}.upload.tmp`);
    const hash = createHash('sha256');
    let size = 0;
    const maxBytes = this.#maxBytes;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          callback(
            new AssetError(413, 'asset_too_large', 'The file is larger than the 100 MB limit.'),
          );
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await writeUpload(body, meter, temp);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }

    const sha256 = hash.digest('hex');
    const existing = this.#index.get().assets.find((asset) => asset.sha256 === sha256);
    if (existing !== undefined) {
      await rm(temp, { force: true });
      return { asset: existing, created: false };
    }

    let id = randomId();
    while (this.get(id) !== undefined) id = randomId();
    const asset: Asset = {
      id,
      name: shown,
      kind: type.kind,
      mime: type.mime,
      size,
      sha256,
      createdAt: this.#now().toISOString(),
    };
    try {
      await rename(temp, join(this.dir, `${id}${type.ext}`));
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
    await this.#index.update((index) => ({ ...index, assets: [...index.assets, asset] }));
    return { asset, created: true };
  }

  /** Removes the asset and its file. False when there is no such asset. */
  async delete(id: string): Promise<boolean> {
    const asset = this.get(id);
    if (asset === undefined) return false;
    await this.#index.update((index) => ({
      ...index,
      assets: index.assets.filter((item) => item.id !== id),
    }));
    await rm(join(this.dir, this.fileName(asset)), { force: true });
    return true;
  }

  flush(): Promise<void> {
    return this.#index.flush();
  }
}
