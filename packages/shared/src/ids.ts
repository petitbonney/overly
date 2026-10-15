import { z } from 'zod';

/** Widget and asset IDs: 12 lowercase letters and digits, safe on case-insensitive file systems. */
export const RANDOM_ID_PATTERN = /^[a-z0-9]{12}$/;

/** Plugin IDs (`overly.alerts`) and event names (`alert.finished`). */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Widget types, node types, action names and port names (`show-alert`). */
export const KEBAB_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Keys of object properties in plugin schemas. */
export const PROPERTY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Semantic Versioning 2.0.0, from semver.org. */
export const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const WidgetIdSchema = z.string().regex(RANDOM_ID_PATTERN, 'Expected a widget ID');
export const AssetIdSchema = z.string().regex(RANDOM_ID_PATTERN, 'Expected an asset ID');
export const PluginIdSchema = z
  .string()
  .max(64)
  .regex(PLUGIN_ID_PATTERN, 'Use lowercase letters and digits, separated by dots or dashes');
export const SemverSchema = z.string().regex(SEMVER_PATTERN, 'Expected a version like 1.0.0');
