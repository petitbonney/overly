import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  defaultSettings,
  type Settings,
  SETTINGS_SCHEMA_VERSION,
  SettingsSchema,
} from '@overly/shared';

import { type DocumentLogger, JsonDocument } from '../storage/json-document.js';

export const SETTINGS_FILE = 'settings.json';

export async function openSettings(
  dataDir: string,
  logger: DocumentLogger,
): Promise<JsonDocument<Settings>> {
  await mkdir(dataDir, { recursive: true });
  return JsonDocument.open({
    path: join(dataDir, SETTINGS_FILE),
    schema: SettingsSchema,
    version: SETTINGS_SCHEMA_VERSION,
    defaults: defaultSettings,
    logger,
  });
}
