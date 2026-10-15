import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  checkManifestRules,
  formatIssues,
  MANIFEST_FILE,
  ManifestHeaderSchema,
  type PluginManifest,
  PluginManifestSchema,
  SUPPORTED_API_VERSIONS,
} from '@overly/shared';
import type { z } from 'zod';

export type LoadedPlugin =
  | { status: 'ok'; dir: string; manifest: PluginManifest }
  | {
      status: 'broken';
      dir: string;
      id?: string | undefined;
      name?: string | undefined;
      version?: string | undefined;
      errors: string[];
    };

type FileCheck = { ok: true; path: string } | { ok: false; reason: 'missing' | 'outside' };

async function checkPluginFile(dir: string, relPath: string): Promise<FileCheck> {
  let root: string;
  let target: string;
  try {
    root = await realpath(dir);
    target = await realpath(join(root, relPath));
  } catch {
    return { ok: false, reason: 'missing' };
  }
  const rel = relative(root, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, reason: 'outside' };
  }
  try {
    if (!(await stat(target)).isFile()) return { ok: false, reason: 'missing' };
  } catch {
    return { ok: false, reason: 'missing' };
  }
  return { ok: true, path: target };
}

/**
 * The real path of a file inside the plugin folder, or `undefined` when it doesn't exist, isn't a
 * file, or resolves (through `..` or a symlink) to somewhere outside the folder.
 */
export async function resolvePluginFile(dir: string, relPath: string): Promise<string | undefined> {
  const check = await checkPluginFile(dir, relPath);
  return check.ok ? check.path : undefined;
}

function issueLines(error: z.ZodError): string[] {
  return formatIssues(error).map(({ path, message }) =>
    path === '' ? message : `${path}: ${message}`,
  );
}

function apiVersionError(apiVersion: number): string {
  const newest = Math.max(...SUPPORTED_API_VERSIONS);
  return apiVersion > newest
    ? `This plugin needs a newer version of Overly (plugin API ${String(apiVersion)}).`
    : `This plugin was made for an older version of Overly (plugin API ${String(apiVersion)}).`;
}

/** Every file the manifest points to, with the field it comes from. */
function referencedFiles(manifest: PluginManifest): [field: string, path: string][] {
  const files: [string, string][] = [];
  if (manifest.icon !== undefined) files.push(['icon', manifest.icon]);
  manifest.widgets.forEach((widget, index) => {
    if (widget.icon !== undefined) files.push([`widgets[${String(index)}].icon`, widget.icon]);
    if (widget.overlay !== undefined) {
      files.push([`widgets[${String(index)}].overlay.entry`, widget.overlay.entry]);
    }
  });
  manifest.nodes.forEach((node, index) => {
    if (node.icon !== undefined) files.push([`nodes[${String(index)}].icon`, node.icon]);
  });
  if (manifest.backend !== undefined) files.push(['backend', manifest.backend]);
  return files;
}

/**
 * Reads and validates `<dir>/overly.plugin.json`: JSON, then the header and `apiVersion` (so a
 * plugin for another plugin API gets one clear error), then the full schema, the manifest rules,
 * and the files it points to. Never throws for a bad plugin: it comes back as `broken`.
 */
export async function loadPlugin(dir: string): Promise<LoadedPlugin> {
  let text: string;
  try {
    text = await readFile(join(dir, MANIFEST_FILE), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'broken', dir, errors: [`${MANIFEST_FILE} can't be read: ${message}`] };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: 'broken', dir, errors: [`${MANIFEST_FILE} is not valid JSON: ${message}`] };
  }

  const header = ManifestHeaderSchema.safeParse(json);
  if (!header.success) return { status: 'broken', dir, errors: issueLines(header.error) };
  const { id, name, version, apiVersion } = header.data;
  const broken = (errors: string[]): LoadedPlugin => ({
    status: 'broken',
    dir,
    id,
    name,
    version,
    errors,
  });

  if (!(SUPPORTED_API_VERSIONS as readonly number[]).includes(apiVersion)) {
    return broken([apiVersionError(apiVersion)]);
  }

  const parsed = PluginManifestSchema.safeParse(json);
  if (!parsed.success) return broken(issueLines(parsed.error));
  const manifest = parsed.data;

  const problems = checkManifestRules(manifest);
  if (problems.length > 0) return broken(problems);

  for (const [field, path] of referencedFiles(manifest)) {
    const check = await checkPluginFile(dir, path);
    if (!check.ok) {
      problems.push(
        check.reason === 'missing'
          ? `${field}: file not found`
          : `${field}: points outside the plugin folder`,
      );
    }
  }
  if (problems.length > 0) return broken(problems);

  return { status: 'ok', dir, manifest };
}
