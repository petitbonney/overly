import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PORT,
  defaultSettings,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
} from './settings.js';

describe('settings', () => {
  it('has defaults that pass the schema', () => {
    expect(SettingsSchema.parse(defaultSettings())).toEqual({
      schemaVersion: 1,
      server: { port: 6859 },
    });
    expect(DEFAULT_PORT).toBe(6859);
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
  });

  it.each([0, 70000, 1.5, '6859'])('rejects port %s', (port) => {
    expect(SettingsSchema.safeParse({ schemaVersion: 1, server: { port } }).success).toBe(false);
  });

  it('rejects another schema version', () => {
    expect(SettingsSchema.safeParse({ schemaVersion: 2, server: { port: 6859 } }).success).toBe(
      false,
    );
  });
});
