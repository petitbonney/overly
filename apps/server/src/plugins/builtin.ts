import alerts from '@overly/plugin-alerts/backend';
import textBanner from '@overly/plugin-text-banner/backend';
import type { PluginBackendDefinition } from '@overly/sdk/backend';

/**
 * Backends of the built-in plugins, by plugin ID. They are bundled into server.mjs and run
 * in-process behind the message protocol (ADR 0015).
 */
export const BUILTIN_BACKENDS: Readonly<Record<string, PluginBackendDefinition>> = {
  'overly.alerts': alerts,
  'overly.text-banner': textBanner,
};
