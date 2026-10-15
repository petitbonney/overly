import { describe, expect, it } from 'vitest';

import {
  checkManifestRules,
  isPublicPath,
  ManifestHeaderSchema,
  parseWidgetTypeRef,
  type PluginManifest,
  PluginManifestSchema,
  publicPaths,
  widgetTypeRef,
} from './manifest.js';

function minimal(): Record<string, unknown> {
  return {
    id: 'test.plugin',
    name: 'Test',
    version: '1.0.0',
    apiVersion: 1,
    widgets: [{ type: 'counter', name: 'Counter', actions: [{ name: 'bump', title: 'Bump' }] }],
  };
}

function withWidget(widget: Record<string, unknown>): Record<string, unknown> {
  return { ...minimal(), widgets: [{ type: 'counter', name: 'Counter', ...widget }] };
}

function parse(manifest: unknown): PluginManifest {
  return PluginManifestSchema.parse(manifest);
}

const fullExample = {
  $schema: '../../docs/plugins/overly.plugin.schema.json',
  id: 'overly.alerts',
  name: 'Alerts',
  version: '1.0.0',
  apiVersion: 1,
  description: 'Image, sound and text alerts, played one after another.',
  author: 'Overly',
  icon: 'icons/alerts.svg',
  permissions: [],
  backend: 'src/backend.ts',
  widgets: [
    {
      type: 'alerts',
      name: 'Alerts',
      description: 'Shows an image, plays a sound and displays a message.',
      icon: 'icons/alerts.svg',
      settings: {
        type: 'object',
        properties: { volume: { type: 'integer', default: 80, minimum: 0, maximum: 100 } },
      },
      overlay: { entry: 'overlay/index.html', width: 1920, height: 1080 },
      queue: { maxLength: 100 },
      actions: [
        {
          name: 'show-alert',
          title: 'Show alert',
          params: {
            type: 'object',
            properties: {
              title: { type: 'string', minLength: 1 },
              message: { type: 'string', default: '' },
            },
            required: ['title'],
          },
          sample: { title: 'Ada just followed!' },
          queued: true,
          timeoutMs: 90000,
        },
      ],
      events: [
        {
          name: 'alert.finished',
          title: 'Alert finished',
          payload: { type: 'object', properties: { title: { type: 'string' } } },
          sample: { title: 'Ada just followed!' },
        },
      ],
    },
  ],
  nodes: [],
};

describe('PluginManifestSchema', () => {
  it('parses a minimal manifest and fills defaults', () => {
    const manifest = parse(minimal());
    expect(manifest.permissions).toEqual([]);
    expect(manifest.nodes).toEqual([]);
    const widget = manifest.widgets[0];
    expect(widget?.settings).toEqual({ type: 'object', properties: {} });
    expect(widget?.queue).toEqual({ maxLength: 100 });
    expect(widget?.actions[0]).toMatchObject({
      queued: false,
      timeoutMs: 30000,
      sample: {},
      params: { type: 'object', properties: {} },
    });
    expect(checkManifestRules(manifest)).toEqual([]);
  });

  it('parses the full example from the spec', () => {
    const manifest = parse(fullExample);
    expect(manifest.widgets[0]?.overlay).toEqual({
      entry: 'overlay/index.html',
      width: 1920,
      height: 1080,
    });
    expect(checkManifestRules(manifest)).toEqual([]);
  });

  it.each(['Overly.Alerts', 'a..b', '-a'])('rejects the plugin ID %s', (id) => {
    expect(PluginManifestSchema.safeParse({ ...minimal(), id }).success).toBe(false);
  });

  it.each(['1.0', 'v1.0.0'])('rejects the version %s', (version) => {
    expect(PluginManifestSchema.safeParse({ ...minimal(), version }).success).toBe(false);
  });

  it.each(['../x.svg', '/x.svg', 'a\\b.svg', 'C:x.svg', 'a//b.svg', './x.svg', 'icon.gif'])(
    'rejects the icon path %s',
    (icon) => {
      expect(PluginManifestSchema.safeParse({ ...minimal(), icon }).success).toBe(false);
    },
  );

  it.each(['index.html', 'overlay/index.htm', 'overlay/../index.html'])(
    'rejects the overlay entry %s',
    (entry) => {
      const manifest = withWidget({ overlay: { entry, width: 800, height: 600 } });
      expect(PluginManifestSchema.safeParse(manifest).success).toBe(false);
    },
  );

  it('rejects unknown keys with their path', () => {
    const result = PluginManifestSchema.safeParse(withWidget({ setings: {} }));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]).toMatchObject({
      path: ['widgets', 0],
      code: 'unrecognized_keys',
    });
  });

  it('rejects unknown permissions', () => {
    expect(
      PluginManifestSchema.safeParse({ ...minimal(), permissions: ['files:write'] }).success,
    ).toBe(false);
  });
});

describe('checkManifestRules', () => {
  it('reports invalid samples with their path', () => {
    const manifest = parse(
      withWidget({
        actions: [
          {
            name: 'show',
            title: 'Show',
            params: {
              type: 'object',
              properties: { title: { type: 'string' } },
              required: ['title'],
            },
            sample: {},
          },
        ],
      }),
    );
    expect(checkManifestRules(manifest)).toEqual([
      'widgets[0].actions[0].sample: title: Invalid input: expected string, received undefined',
    ]);
  });

  it('reports duplicate names', () => {
    const manifest = parse({
      ...minimal(),
      widgets: [
        {
          type: 'counter',
          name: 'A',
          actions: [
            { name: 'bump', title: 'Bump' },
            { name: 'bump', title: 'Bump again' },
          ],
          events: [
            { name: 'counter.changed', title: 'Changed' },
            { name: 'counter.changed', title: 'Changed again' },
          ],
        },
        { type: 'counter', name: 'B' },
      ],
    });
    expect(checkManifestRules(manifest)).toEqual([
      'widgets[0].actions[1].name: "bump" is declared twice',
      'widgets[0].events[1].name: "counter.changed" is declared twice',
      'widgets[1].type: "counter" is declared twice',
    ]);
  });

  it('reports settings without defaults and invalid defaults', () => {
    const missing = parse(
      withWidget({ settings: { type: 'object', properties: { size: { type: 'integer' } } } }),
    );
    expect(checkManifestRules(missing)).toEqual([
      'widgets[0].settings.properties.size: needs a default',
    ]);
    const invalid = parse(
      withWidget({
        settings: {
          type: 'object',
          properties: { size: { type: 'integer', default: 500, maximum: 200 } },
        },
      }),
    );
    expect(checkManifestRules(invalid)).toEqual([
      'widgets[0].settings: invalid default: size: Too big: expected number to be <=200',
    ]);
  });

  it('reports a plugin without widgets or nodes', () => {
    expect(checkManifestRules(parse({ ...minimal(), widgets: [] }))).toEqual([
      'The plugin declares no widgets or nodes.',
    ]);
  });
});

describe('manifest helpers', () => {
  it('reads the header of a manifest for a future API', () => {
    const header = ManifestHeaderSchema.parse({ ...minimal(), apiVersion: 2, futureKey: 1 });
    expect(header).toMatchObject({ id: 'test.plugin', apiVersion: 2 });
  });

  it('builds and parses widget type references', () => {
    expect(widgetTypeRef('overly.alerts', 'alerts')).toBe('overly.alerts:alerts');
    expect(parseWidgetTypeRef('overly.alerts:alerts')).toEqual({
      pluginId: 'overly.alerts',
      type: 'alerts',
    });
    for (const ref of ['overly.alerts', 'a:b:c', 'Overly:alerts', 'overly.alerts:']) {
      expect(parseWidgetTypeRef(ref)).toBeUndefined();
    }
  });

  it('lists overlay directories and icons as public paths', () => {
    const paths = publicPaths(parse(fullExample));
    expect(paths).toEqual({ dirs: ['overlay'], files: ['icons/alerts.svg'] });
    expect(isPublicPath(paths, 'overlay/index.html')).toBe(true);
    expect(isPublicPath(paths, 'overlay/img/a.png')).toBe(true);
    expect(isPublicPath(paths, 'icons/alerts.svg')).toBe(true);
    for (const path of [
      'overly.plugin.json',
      'src/backend.ts',
      'overlay/../overly.plugin.json',
      'overlay/.env',
      'overlayx/a.js',
      'overlay',
      'icons/other.svg',
    ]) {
      expect(isPublicPath(paths, path)).toBe(false);
    }
  });
});
