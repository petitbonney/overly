import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

import {
  type ActionDecl,
  isPublicPath,
  MANIFEST_FILE,
  type PluginManifest,
  publicPaths,
  schemaToZod,
  settingsDefaults,
  type WidgetTypeDecl,
  widgetTypeRef,
} from '@overly/shared';
import type pino from 'pino';
import type { z } from 'zod';

import { loadPlugin, resolvePluginFile } from './loader.js';

type ObjectSchema = z.ZodType<Record<string, unknown>>;

export interface CompiledAction {
  decl: ActionDecl;
  params: ObjectSchema;
  output: ObjectSchema | undefined;
}

/** A widget type of an ok plugin, with its schemas compiled to Zod. */
export interface WidgetTypeDef {
  /** `<pluginId>:<type>` */
  ref: string;
  pluginId: string;
  pluginDir: string;
  manifest: PluginManifest;
  decl: WidgetTypeDecl;
  settings: ObjectSchema;
  /** Fresh default settings for a new widget. */
  defaults(): Record<string, unknown>;
  actions: ReadonlyMap<string, CompiledAction>;
  events: ReadonlyMap<string, ObjectSchema>;
  /** The widget icon, else the plugin icon. */
  iconPath: string | undefined;
}

export interface PluginEntry {
  dir: string;
  folder: string;
  id: string | undefined;
  name: string;
  version: string | undefined;
  status: 'ok' | 'broken';
  manifest: PluginManifest | undefined;
  errors: string[];
}

function compileWidgetTypes(entry: PluginEntry, manifest: PluginManifest): WidgetTypeDef[] {
  return manifest.widgets.map((decl) => ({
    ref: widgetTypeRef(manifest.id, decl.type),
    pluginId: manifest.id,
    pluginDir: entry.dir,
    manifest,
    decl,
    settings: schemaToZod(decl.settings),
    defaults: () => settingsDefaults(decl.settings),
    actions: new Map(
      decl.actions.map((action) => [
        action.name,
        {
          decl: action,
          params: schemaToZod(action.params),
          output: action.output === undefined ? undefined : schemaToZod(action.output),
        },
      ]),
    ),
    events: new Map(decl.events.map((event) => [event.name, schemaToZod(event.payload)])),
    iconPath: decl.icon ?? manifest.icon,
  }));
}

async function hasManifest(dir: string): Promise<boolean> {
  try {
    return (await stat(join(dir, MANIFEST_FILE))).isFile();
  } catch {
    return false;
  }
}

/**
 * The plugins found in the plugins folder, ok or broken. A broken plugin never stops the server:
 * it is listed with its errors, and its widget types are unavailable.
 */
export class PluginRegistry {
  readonly #entries: PluginEntry[];
  readonly #types = new Map<string, WidgetTypeDef>();

  private constructor(entries: PluginEntry[]) {
    this.#entries = entries;
    for (const entry of entries) {
      if (entry.status !== 'ok' || entry.manifest === undefined) continue;
      for (const type of compileWidgetTypes(entry, entry.manifest)) this.#types.set(type.ref, type);
    }
  }

  static async load(options: { pluginsDir: string; logger: pino.Logger }): Promise<PluginRegistry> {
    const { pluginsDir, logger } = options;
    let folders: string[];
    try {
      const entries = await readdir(pluginsDir, { withFileTypes: true });
      folders = entries
        .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      logger.warn({ err: error, pluginsDir }, 'The plugins folder could not be read');
      return new PluginRegistry([]);
    }

    const entries: PluginEntry[] = [];
    const folderById = new Map<string, string>();
    for (const folder of folders) {
      const dir = join(pluginsDir, folder);
      if (!(await hasManifest(dir))) continue;
      const loaded = await loadPlugin(dir);
      let entry: PluginEntry;
      if (loaded.status === 'ok') {
        const { manifest } = loaded;
        const taken = folderById.get(manifest.id);
        entry = {
          dir,
          folder,
          id: manifest.id,
          name: manifest.name,
          version: manifest.version,
          status: taken === undefined ? 'ok' : 'broken',
          manifest,
          errors:
            taken === undefined
              ? []
              : [`Another plugin folder (${taken}) already uses the ID ${manifest.id}.`],
        };
        if (taken === undefined) folderById.set(manifest.id, folder);
      } else {
        entry = {
          dir,
          folder,
          id: loaded.id,
          name: loaded.name ?? basename(dir),
          version: loaded.version,
          status: 'broken',
          manifest: undefined,
          errors: loaded.errors,
        };
      }
      if (entry.status === 'broken') {
        logger.warn({ plugin: entry.id ?? folder, errors: entry.errors }, 'Plugin is broken');
      }
      entries.push(entry);
    }
    logger.info(
      { ok: entries.filter((entry) => entry.status === 'ok').map((entry) => entry.id) },
      'Plugins loaded',
    );
    return new PluginRegistry(entries);
  }

  plugins(): readonly PluginEntry[] {
    return this.#entries;
  }

  /** The plugin that owns this ID (the first folder that declared it). */
  plugin(id: string): PluginEntry | undefined {
    return (
      this.#entries.find((entry) => entry.id === id && entry.status === 'ok') ??
      this.#entries.find((entry) => entry.id === id)
    );
  }

  widgetTypes(): readonly WidgetTypeDef[] {
    return [...this.#types.values()];
  }

  widgetType(ref: string): WidgetTypeDef | undefined {
    return this.#types.get(ref);
  }

  /** Marks an ok plugin as broken (its backend failed): its widget types disappear. */
  markBroken(pluginId: string, error: string): void {
    const entry = this.#entries.find((item) => item.id === pluginId && item.status === 'ok');
    if (entry === undefined) return;
    entry.status = 'broken';
    entry.errors = [error];
    for (const [ref, type] of this.#types) {
      if (type.pluginId === pluginId) this.#types.delete(ref);
    }
  }

  /**
   * The real path of a public file of an ok plugin (overlay folders and icons), or `undefined`.
   * Anything outside the public set, dot-files and paths escaping the folder are refused.
   */
  async publicFile(pluginId: string, relPath: string): Promise<string | undefined> {
    const entry = this.plugin(pluginId);
    if (entry?.status !== 'ok' || entry.manifest === undefined) return undefined;
    if (!isPublicPath(publicPaths(entry.manifest), relPath)) return undefined;
    return resolvePluginFile(entry.dir, relPath);
  }
}
