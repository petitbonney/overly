import { PRODUCT_NAME } from '@overly/shared';

export const NAME = `${PRODUCT_NAME} SDK`;

export * from './backend/index.js';
export type { OverlaySdk, OverlayWidget } from './overlay/sdk.js';
