import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { fixtureManifest, writeTestPlugin } from '../testing/plugins.js';
import { loadPlugin, resolvePluginFile } from './loader.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'overly-plugins-'));
});

describe('loadPlugin', () => {
  it('loads a valid plugin', async () => {
    const dir = await writeTestPlugin(root, 'fixture', fixtureManifest());
    const plugin = await loadPlugin(dir);
    expect(plugin.status).toBe('ok');
    if (plugin.status !== 'ok') return;
    expect(plugin.manifest.id).toBe('fixture.widgets');
    expect(plugin.manifest.widgets[0]?.queue.maxLength).toBe(100);
  });

  it('reports invalid JSON', async () => {
    const plugin = await loadPlugin(await writeTestPlugin(root, 'p', '{ "id": '));
    expect(plugin.status).toBe('broken');
    if (plugin.status !== 'broken') return;
    expect(plugin.errors).toHaveLength(1);
    expect(plugin.errors[0]).toMatch(/^overly\.plugin\.json is not valid JSON: /);
  });

  it('reports an unsupported apiVersion as a single error', async () => {
    const plugin = await loadPlugin(
      await writeTestPlugin(root, 'p', { ...fixtureManifest(), apiVersion: 2, unknown: true }),
    );
    expect(plugin).toEqual({
      status: 'broken',
      dir: join(root, 'p'),
      id: 'fixture.widgets',
      name: 'Fixture widgets',
      version: '1.0.0',
      errors: ['This plugin needs a newer version of Overly (plugin API 2).'],
    });
  });

  it('reports schema issues with their path', async () => {
    const manifest = fixtureManifest();
    const plugin = await loadPlugin(
      await writeTestPlugin(root, 'p', {
        ...manifest,
        widgets: [{ type: 'counter', name: 'Counter', setings: {} }],
      }),
    );
    expect(plugin).toMatchObject({ status: 'broken', id: 'fixture.widgets' });
    if (plugin.status !== 'broken') return;
    expect(plugin.errors).toEqual([expect.stringMatching(/^widgets\.0: .*setings/)]);
  });

  it('reports manifest rule problems', async () => {
    const plugin = await loadPlugin(
      await writeTestPlugin(root, 'p', fixtureManifest({ widgets: [] })),
    );
    expect(plugin).toMatchObject({
      status: 'broken',
      errors: ['The plugin declares no widgets or nodes.'],
    });
  });

  it('reports a missing overlay entry and a missing backend file', async () => {
    const plugin = await loadPlugin(
      await writeTestPlugin(root, 'p', fixtureManifest({ backend: 'src/backend.js' }), {
        'overlay/index.html': null,
      }),
    );
    expect(plugin).toMatchObject({
      status: 'broken',
      errors: ['widgets[0].overlay.entry: file not found', 'backend: file not found'],
    });
  });

  it.skipIf(process.platform === 'win32')(
    'refuses an icon symlinked from outside the folder',
    async () => {
      const outside = join(root, 'outside.svg');
      await writeFile(outside, '<svg/>');
      const dir = await writeTestPlugin(root, 'p', fixtureManifest(), { 'icons/icon.svg': null });
      await mkdir(join(dir, 'icons'));
      await symlink(outside, join(dir, 'icons', 'icon.svg'));
      const plugin = await loadPlugin(dir);
      expect(plugin).toMatchObject({
        status: 'broken',
        errors: ['icon: points outside the plugin folder'],
      });
    },
  );
});

describe('resolvePluginFile', () => {
  it('resolves files inside the folder only', async () => {
    const dir = await writeTestPlugin(root, 'p', fixtureManifest());
    await mkdir(join(dir, 'overlay', 'sub'));
    await writeFile(join(root, 'outside.svg'), '<svg/>');
    expect(await resolvePluginFile(dir, 'overlay/index.html')).toMatch(/index\.html$/);
    expect(await resolvePluginFile(dir, 'overlay/sub')).toBeUndefined();
    expect(await resolvePluginFile(dir, 'overlay/missing.js')).toBeUndefined();
    expect(await resolvePluginFile(dir, '../outside.svg')).toBeUndefined();
  });
});
