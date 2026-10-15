/** How long an action may run, in milliseconds (manifest `timeoutMs`). */
export const ACTION_TIMEOUT_MS = { min: 100, max: 600_000, default: 30_000 } as const;

/** Pending queued actions a widget keeps by default (manifest `queue.maxLength`). */
export const DEFAULT_QUEUE_MAX_LENGTH = 100;

/** Priority of a queued action: higher runs first. */
export const ACTION_PRIORITY = { min: -100, max: 100, default: 0 } as const;
