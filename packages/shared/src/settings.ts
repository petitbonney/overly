import { z } from 'zod';

/** Default port of the local server. It is part of every OBS overlay URL, so it must stay stable. */
export const DEFAULT_PORT = 6859;

export const SETTINGS_SCHEMA_VERSION = 1;

export const PortSchema = z.int().min(1).max(65535);

/** `settings.json` in the app-data folder. */
export const SettingsSchema = z.object({
  schemaVersion: z.literal(SETTINGS_SCHEMA_VERSION),
  server: z.object({
    port: PortSchema,
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;

export function defaultSettings(): Settings {
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, server: { port: DEFAULT_PORT } };
}
