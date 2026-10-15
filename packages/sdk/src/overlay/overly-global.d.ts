// Types of the `overly` global for overlay pages. Plain-JS overlays get them with
// `"types": ["@overly/sdk/overlay-global"]` in their tsconfig, or
// `/// <reference types="@overly/sdk/overlay-global" />`.
import type { OverlaySdk } from './sdk.js';

declare global {
  var overly: OverlaySdk;
}

export {};
