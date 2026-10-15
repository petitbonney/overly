import { z } from 'zod';

import { KEBAB_NAME_PATTERN, PLUGIN_ID_PATTERN, PluginIdSchema, SemverSchema } from '../ids.js';
import { checkSchemaRules, type ObjectField, ObjectFieldSchema } from '../schema/subset.js';
import { formatIssues, schemaToZod, settingsDefaults } from '../schema/to-zod.js';

// The overly.plugin.json manifest (see docs/plugins/README.md and ADR 0005).

export const MANIFEST_FILE = 'overly.plugin.json';

/** Plugin API versions this build of Overly can load. */
export const SUPPORTED_API_VERSIONS = [1] as const;

export const PERMISSIONS = [
  'events:read',
  'chat:write',
  'rewards:manage',
  'polls:manage',
  'predictions:manage',
  'input:keyboard',
  'input:mouse',
  'network',
] as const;
export const PermissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof PermissionSchema>;

/** A path inside the plugin folder: `/` separators, no `.` or `..` segments, nothing absolute. */
export function isRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes(':')) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

export const RelativePathSchema = z
  .string()
  .refine(isRelativePath, 'Use a relative path inside the plugin folder, with / separators');

const IconPathSchema = RelativePathSchema.refine(
  (path) => /\.(?:svg|png|webp)$/i.test(path),
  'Icons are .svg, .png or .webp files',
);

const KebabNameSchema = z
  .string()
  .max(64)
  .regex(KEBAB_NAME_PATTERN, 'Use lowercase letters and digits, separated by dashes');
const EventNameSchema = z
  .string()
  .max(64)
  .regex(PLUGIN_ID_PATTERN, 'Use lowercase letters and digits, separated by dots or dashes');
const NameSchema = z.string().trim().min(1).max(64);
const DescriptionSchema = z.string().max(500);

function emptyObjectSchema(): ObjectField {
  return { type: 'object', properties: {} };
}

const RootSchema = ObjectFieldSchema.default(emptyObjectSchema);
const SampleSchema = z.record(z.string(), z.unknown()).default(() => ({}));

export const OverlayDeclSchema = z.strictObject({
  entry: RelativePathSchema.refine(
    (path) => path.endsWith('.html') && path.includes('/'),
    'The overlay entry is an .html file inside a folder, like overlay/index.html',
  ),
  width: z.int().min(1).max(7680),
  height: z.int().min(1).max(4320),
});

export const ActionDeclSchema = z.strictObject({
  name: KebabNameSchema,
  title: NameSchema,
  description: DescriptionSchema.optional(),
  params: RootSchema,
  output: ObjectFieldSchema.optional(),
  sample: SampleSchema,
  queued: z.boolean().default(false),
  timeoutMs: z.int().min(100).max(600_000).default(30_000),
});

export const EventDeclSchema = z.strictObject({
  name: EventNameSchema,
  title: NameSchema,
  description: DescriptionSchema.optional(),
  payload: RootSchema,
  sample: SampleSchema,
});

export const WidgetTypeDeclSchema = z.strictObject({
  type: KebabNameSchema,
  name: NameSchema,
  description: DescriptionSchema.optional(),
  icon: IconPathSchema.optional(),
  settings: RootSchema,
  overlay: OverlayDeclSchema.optional(),
  queue: z
    .strictObject({ maxLength: z.int().min(1).max(1000).default(100) })
    .default(() => ({ maxLength: 100 })),
  actions: z.array(ActionDeclSchema).default(() => []),
  events: z.array(EventDeclSchema).default(() => []),
});

export const PortDeclSchema = z.strictObject({
  name: KebabNameSchema,
  title: z.string().max(64).optional(),
});

/** Node types are validated now and run from Phase 4. */
export const NodeTypeDeclSchema = z.strictObject({
  type: KebabNameSchema,
  name: NameSchema,
  description: DescriptionSchema.optional(),
  icon: IconPathSchema.optional(),
  category: z.enum(['trigger', 'logic', 'action']),
  inputs: z.array(PortDeclSchema).default(() => []),
  outputs: z.array(PortDeclSchema).default(() => []),
  settings: RootSchema,
  output: ObjectFieldSchema.optional(),
  permissions: z.array(PermissionSchema).default(() => []),
});

export const PluginManifestSchema = z.strictObject({
  $schema: z.string().optional(),
  id: PluginIdSchema,
  name: NameSchema,
  version: SemverSchema,
  apiVersion: z.int().positive(),
  description: DescriptionSchema.optional(),
  author: z.string().max(200).optional(),
  icon: IconPathSchema.optional(),
  permissions: z
    .array(PermissionSchema)
    .refine((list) => new Set(list).size === list.length, 'Permissions must be unique')
    .default(() => []),
  backend: RelativePathSchema.optional(),
  widgets: z.array(WidgetTypeDeclSchema).default(() => []),
  nodes: z.array(NodeTypeDeclSchema).default(() => []),
});

export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type WidgetTypeDecl = z.infer<typeof WidgetTypeDeclSchema>;
export type ActionDecl = z.infer<typeof ActionDeclSchema>;
export type EventDecl = z.infer<typeof EventDeclSchema>;
export type NodeTypeDecl = z.infer<typeof NodeTypeDeclSchema>;

/**
 * The part of a manifest read before anything else, so a plugin written for another plugin API
 * gets one clear error instead of a list of keys this build doesn't know.
 */
export const ManifestHeaderSchema = z.looseObject({
  id: PluginIdSchema,
  name: NameSchema,
  version: SemverSchema,
  apiVersion: z.int().positive(),
});

function issueLines(prefix: string, error: z.ZodError): string[] {
  return formatIssues(error).map(({ path, message }) =>
    path === '' ? `${prefix}: ${message}` : `${prefix}: ${path}: ${message}`,
  );
}

function duplicates(
  items: readonly { name: string }[],
  path: (index: number) => string,
  label = 'name',
): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  items.forEach((item, index) => {
    if (seen.has(item.name)) {
      problems.push(`${path(index)}.${label}: "${item.name}" is declared twice`);
    }
    seen.add(item.name);
  });
  return problems;
}

function checkSample(schema: ObjectField, sample: unknown, path: string): string[] {
  if (checkSchemaRules(schema, { requireDefaults: false, path }).length > 0) return [];
  const result = schemaToZod(schema).safeParse(sample);
  return result.success ? [] : issueLines(path, result.error);
}

function checkSettings(schema: ObjectField, path: string): string[] {
  const problems = checkSchemaRules(schema, { requireDefaults: true, path });
  if (problems.length > 0) return problems;
  try {
    settingsDefaults(schema);
    return [];
  } catch (error) {
    if (error instanceof z.ZodError) return issueLines(`${path}: invalid default`, error);
    throw error;
  }
}

/**
 * Rules the schema can't express: unique names, valid schemas, samples that pass their schema,
 * and settings with complete, valid defaults. Returns readable messages with their path.
 */
export function checkManifestRules(manifest: PluginManifest): string[] {
  if (manifest.widgets.length === 0 && manifest.nodes.length === 0) {
    return ['The plugin declares no widgets or nodes.'];
  }
  const problems: string[] = [];

  manifest.widgets.forEach((widget, w) => {
    const at = `widgets[${String(w)}]`;
    problems.push(...checkSettings(widget.settings, `${at}.settings`));
    problems.push(...duplicates(widget.actions, (i) => `${at}.actions[${String(i)}]`));
    widget.actions.forEach((action, a) => {
      const actionAt = `${at}.actions[${String(a)}]`;
      problems.push(
        ...checkSchemaRules(action.params, { requireDefaults: false, path: `${actionAt}.params` }),
      );
      if (action.output !== undefined) {
        problems.push(
          ...checkSchemaRules(action.output, {
            requireDefaults: false,
            path: `${actionAt}.output`,
          }),
        );
      }
      problems.push(...checkSample(action.params, action.sample, `${actionAt}.sample`));
    });
    problems.push(...duplicates(widget.events, (i) => `${at}.events[${String(i)}]`));
    widget.events.forEach((event, e) => {
      const eventAt = `${at}.events[${String(e)}]`;
      problems.push(
        ...checkSchemaRules(event.payload, { requireDefaults: false, path: `${eventAt}.payload` }),
      );
      problems.push(...checkSample(event.payload, event.sample, `${eventAt}.sample`));
    });
  });
  problems.push(
    ...duplicates(
      manifest.widgets.map((widget) => ({ name: widget.type })),
      (i) => `widgets[${String(i)}]`,
      'type',
    ),
  );

  manifest.nodes.forEach((node, n) => {
    const at = `nodes[${String(n)}]`;
    problems.push(...checkSettings(node.settings, `${at}.settings`));
    if (node.output !== undefined) {
      problems.push(
        ...checkSchemaRules(node.output, { requireDefaults: false, path: `${at}.output` }),
      );
    }
  });
  problems.push(
    ...duplicates(
      manifest.nodes.map((node) => ({ name: node.type })),
      (i) => `nodes[${String(i)}]`,
      'type',
    ),
  );

  return problems;
}

/** `<pluginId>:<type>`, how widgets refer to their type. */
export function widgetTypeRef(pluginId: string, type: string): string {
  return `${pluginId}:${type}`;
}

export function parseWidgetTypeRef(ref: string): { pluginId: string; type: string } | undefined {
  const parts = ref.split(':');
  if (parts.length !== 2) return undefined;
  const [pluginId = '', type = ''] = parts;
  if (!PluginIdSchema.safeParse(pluginId).success || !KebabNameSchema.safeParse(type).success) {
    return undefined;
  }
  return { pluginId, type };
}

export const WidgetTypeRefSchema = z
  .string()
  .refine((ref) => parseWidgetTypeRef(ref) !== undefined, 'Expected <pluginId>:<type>');

export interface PublicPaths {
  /** Folders whose files are public: the folder of each overlay entry. */
  dirs: string[];
  /** Single public files: the plugin and widget icons. */
  files: string[];
}

/** The only files of a plugin that Overly serves over HTTP or copies into a build. */
export function publicPaths(manifest: PluginManifest): PublicPaths {
  const dirs = new Set<string>();
  const files = new Set<string>();
  if (manifest.icon !== undefined) files.add(manifest.icon);
  for (const widget of manifest.widgets) {
    if (widget.icon !== undefined) files.add(widget.icon);
    if (widget.overlay !== undefined) {
      dirs.add(widget.overlay.entry.slice(0, widget.overlay.entry.lastIndexOf('/')));
    }
  }
  return { dirs: [...dirs], files: [...files] };
}

/** True for a relative path to a public file. Dot-files and `..` are never public. */
export function isPublicPath(paths: PublicPaths, relPath: string): boolean {
  if (!isRelativePath(relPath)) return false;
  if (relPath.split('/').some((segment) => segment.startsWith('.'))) return false;
  return paths.files.includes(relPath) || paths.dirs.some((dir) => relPath.startsWith(`${dir}/`));
}
