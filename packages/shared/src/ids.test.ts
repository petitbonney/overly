import { describe, expect, it } from 'vitest';

import { PluginIdSchema, SemverSchema, WidgetIdSchema } from './ids.js';

describe('IDs and versions', () => {
  it.each(['1.0.0', '1.1.0-beta.1', '1.0.0+build.5', '10.20.30-rc.1+sha.abc'])(
    'accepts the version %s',
    (version) => {
      expect(SemverSchema.safeParse(version).success).toBe(true);
    },
  );

  it.each(['1.0', 'v1.0.0', '01.0.0', '1.0.0-'])('rejects the version %s', (version) => {
    expect(SemverSchema.safeParse(version).success).toBe(false);
  });

  it('accepts lowercase dotted or dashed plugin IDs up to 64 characters', () => {
    expect(PluginIdSchema.safeParse('overly.alerts').success).toBe(true);
    expect(PluginIdSchema.safeParse('my-plugin.v2').success).toBe(true);
    expect(PluginIdSchema.safeParse('a'.repeat(64)).success).toBe(true);
    for (const id of ['Overly.Alerts', 'a..b', '-a', 'a.', 'a'.repeat(65)]) {
      expect(PluginIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it('accepts 12 lowercase letters and digits as a widget ID', () => {
    expect(WidgetIdSchema.safeParse('abcdefghij12').success).toBe(true);
    for (const id of ['ABCDEFGHIJ12', 'abcdefghij1', 'abcdefghij123', '../abcdefghi']) {
      expect(WidgetIdSchema.safeParse(id).success).toBe(false);
    }
  });
});
