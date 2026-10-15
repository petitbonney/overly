import { type ActionWarning, formatIssues } from '@overly/shared';

import type { CompiledAction, WidgetTypeDef } from '../plugins/registry.js';
import type { PluginBackendConnection } from './backend-host.js';
import type { OverlayHub } from './overlay-hub.js';

export interface ExecuteActionInput {
  typeDef: WidgetTypeDef;
  widgetId: string;
  action: CompiledAction;
  params: Record<string, unknown>;
  actionId: string;
  connection: PluginBackendConnection | undefined;
  overlays: OverlayHub;
  warn: (warning: ActionWarning) => void;
}

/**
 * Runs one action: in the plugin backend when it handles it, otherwise in the overlays. Both
 * paths stop at the action's `timeoutMs`. A result that fails the declared output schema makes
 * the action fail.
 */
export async function executeAction(input: ExecuteActionInput): Promise<unknown> {
  const { typeDef, widgetId, action, params, actionId, connection, overlays } = input;
  const { name, timeoutMs } = action.decl;

  let result: unknown;
  if (connection?.handles(typeDef.decl.type, name) === true && connection.isStarted(widgetId)) {
    result = await connection.runAction(widgetId, { actionId, name, params, timeoutMs });
  } else {
    const outcome = await overlays.runAction(widgetId, name, params, timeoutMs);
    if (outcome.delivered) result = outcome.result;
    else input.warn('no_overlay');
  }

  // Nothing came back (no overlay, or a handler without a result): there is no output to check.
  if (action.output !== undefined && result !== undefined) {
    const checked = action.output.safeParse(result);
    if (!checked.success) {
      const issues = formatIssues(checked.error)
        .map(({ path, message }) => (path === '' ? message : `${path}: ${message}`))
        .join('; ');
      throw new Error(`invalid_output: ${issues}`);
    }
    return checked.data;
  }
  return result;
}
