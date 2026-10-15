import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import pino from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { fixtureManifest, writeTestPlugin } from '../testing/plugins.js';
import { BackendHost } from '../widgets/backend-host.js';
import { BUILTIN_BACKENDS } from './builtin.js';
import { PluginRegistry } from './registry.js';

const logger = pino({ level: 'silent' });
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overly-registry-'));
});

async function load(): Promise<PluginRegistry> {
  return PluginRegistry.load({ pluginsDir: root, logger });
}

describe('PluginRegistry', () => {
  it('loads ok and broken plugins side by side', async () => {
    await writeTestPlugin(root, 'good', fixtureManifest());
    await writeTestPlugin(root, 'bad', { ...fixtureManifest({ id: 'bad.plugin' }), apiVersion: 9 });
    await writeTestPlugin(root, 'not-a-plugin', fixtureManifest());
    await writeFile(join(root, 'not-a-plugin', 'overly.plugin.json'), '{}');
    const registry = await load();

    expect(registry.plugins().map((plugin) => [plugin.folder, plugin.status])).toEqual([
      ['bad', 'broken'],
      ['good', 'ok'],
      ['not-a-plugin', 'broken'],
    ]);
    expect(registry.plugin('bad.plugin')?.errors).toEqual([
      'This plugin needs a newer version of Overly (plugin API 9).',
    ]);
    expect(registry.widgetTypes().map((type) => type.ref)).toEqual(['fixture.widgets:counter']);
  });

  it('ignores folders without a manifest', async () => {
    await writeTestPlugin(root, 'good', fixtureManifest());
    await writeFile(join(root, 'README.md'), '# notes');
    await writeTestPlugin(root, 'empty', fixtureManifest());
    const { rm } = await import('node:fs/promises');
    await rm(join(root, 'empty', 'overly.plugin.json'));
    expect((await load()).plugins().map((plugin) => plugin.folder)).toEqual(['good']);
  });

  it('marks a duplicate plugin ID as broken', async () => {
    await writeTestPlugin(root, 'a-first', fixtureManifest());
    await writeTestPlugin(root, 'b-second', fixtureManifest());
    const registry = await load();
    const second = registry.plugins().find((plugin) => plugin.folder === 'b-second');
    expect(second).toMatchObject({
      status: 'broken',
      errors: ['Another plugin folder (a-first) already uses the ID fixture.widgets.'],
    });
    expect(registry.plugin('fixture.widgets')?.folder).toBe('a-first');
  });

  it('returns an empty registry when the folder is missing', async () => {
    const registry = await PluginRegistry.load({ pluginsDir: join(root, 'nope'), logger });
    expect(registry.plugins()).toEqual([]);
  });

  it('compiles settings, defaults, params and event schemas', async () => {
    await writeTestPlugin(root, 'good', fixtureManifest());
    const type = (await load()).widgetType('fixture.widgets:counter');
    expect(type).toBeDefined();
    if (type === undefined) return;
    expect(type.defaults()).toEqual({ label: 'Count', step: 1 });
    expect(type.settings.safeParse({ label: 'x', step: 11 }).success).toBe(false);
    expect(type.actions.get('bump')?.params.safeParse({ by: 2 }).success).toBe(true);
    expect(type.actions.get('bump')?.params.safeParse({}).success).toBe(false);
    expect(type.actions.get('bump')?.decl.queued).toBe(true);
    expect(type.events.get('counter.changed')?.safeParse({ value: 'x' }).success).toBe(false);
    expect(type.iconPath).toBe('icons/icon.svg');
    expect(type.pluginDir).toBe(join(root, 'good'));
  });

  it('markBroken removes the plugin types', async () => {
    await writeTestPlugin(root, 'good', fixtureManifest());
    const registry = await load();
    registry.markBroken('fixture.widgets', 'backend not available');
    expect(registry.plugin('fixture.widgets')).toMatchObject({
      status: 'broken',
      errors: ['backend not available'],
    });
    expect(registry.widgetType('fixture.widgets:counter')).toBeUndefined();
  });

  it('publicFile refuses paths outside the public set', async () => {
    await writeTestPlugin(root, 'good', fixtureManifest(), {
      'overlay/.secret': 'x',
      'src/backend.ts': 'export {}',
    });
    const registry = await load();
    for (const path of [
      'overly.plugin.json',
      'overlay/../overly.plugin.json',
      'overlay\\..\\overly.plugin.json',
      'overlay/.secret',
      'src/backend.ts',
      '/etc/passwd',
    ]) {
      expect(await registry.publicFile('fixture.widgets', path)).toBeUndefined();
    }
    expect(await registry.publicFile('fixture.widgets', 'overlay/index.html')).toMatch(
      /index\.html$/,
    );
    expect(await registry.publicFile('fixture.widgets', 'icons/icon.svg')).toBeDefined();
    expect(await registry.publicFile('missing.plugin', 'overlay/index.html')).toBeUndefined();
  });
});

describe('built-in plugins', () => {
  it('loads the built-in plugins without errors', async () => {
    const registry = await PluginRegistry.load({
      pluginsDir: fileURLToPath(new URL('../../../../plugins/', import.meta.url)),
      logger,
    });
    const backends = await BackendHost.start({
      registry,
      builtins: BUILTIN_BACKENDS,
      delegate: {
        setState: () => undefined,
        emitToOverlay: () => undefined,
        overlayAction: () => Promise.resolve({ delivered: false }),
        emitEvent: () => undefined,
      },
      logger,
    });
    expect(registry.plugins().map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(['overly.alerts', 'overly.text-banner']),
    );
    for (const plugin of registry.plugins()) {
      expect(plugin, plugin.folder).toMatchObject({ status: 'ok', errors: [] });
    }
    await backends.close();
  });
});
