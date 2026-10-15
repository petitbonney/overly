import { notifications } from '@mantine/notifications';
import type { WidgetActionMessage } from '@overly/shared';
import { useRef } from 'react';

import { useActionUpdates } from '../connection/ServerConnection.js';

export const NO_OVERLAY_MESSAGE =
  'Done, but no overlay is connected: add the URL to OBS or keep the preview open';

/** Messages kept for actions whose ID isn't known yet (their HTTP answer is still coming). */
const EARLY_LIMIT = 50;

function show(id: string, title: string, message: WidgetActionMessage): boolean {
  switch (message.status) {
    case 'queued':
      notifications.update({
        id,
        title,
        message: 'Waiting for the actions before it…',
        loading: true,
      });
      return false;
    case 'running':
      notifications.update({ id, title, message: 'Running…', loading: true });
      return false;
    case 'done': {
      const noOverlay = message.warnings.includes('no_overlay');
      notifications.update({
        id,
        title,
        message: noOverlay ? NO_OVERLAY_MESSAGE : 'Done',
        color: noOverlay ? 'yellow' : 'green',
        loading: false,
        autoClose: noOverlay ? 8000 : 3000,
        withCloseButton: true,
      });
      return true;
    }
    case 'failed':
      notifications.update({
        id,
        title,
        message: `Failed: ${message.error ?? 'unknown error'}`,
        color: 'red',
        loading: false,
        autoClose: 8000,
        withCloseButton: true,
      });
      return true;
    case 'cancelled':
      notifications.update({
        id,
        title,
        message: 'Cancelled',
        color: 'gray',
        loading: false,
        autoClose: 3000,
        withCloseButton: true,
      });
      return true;
  }
}

/**
 * One notification per action started from this tab, updated from the server's `widget.action`
 * messages until the action is done, failed or cancelled.
 */
export function useActionNotifications() {
  const titles = useRef(new Map<string, string>());
  const early = useRef(new Map<string, WidgetActionMessage>());

  useActionUpdates((message) => {
    const title = titles.current.get(message.actionId);
    if (title === undefined) {
      // The action may be ours, and its HTTP answer not here yet: keep its latest message.
      early.current.set(message.actionId, message);
      if (early.current.size > EARLY_LIMIT) {
        const [oldest] = early.current.keys();
        if (oldest !== undefined) early.current.delete(oldest);
      }
      return;
    }
    if (show(message.actionId, title, message)) titles.current.delete(message.actionId);
  });

  return {
    /** Call with the action ID the server answered. */
    started(actionId: string, title: string): void {
      notifications.show({
        id: actionId,
        title,
        message: 'Running…',
        loading: true,
        autoClose: false,
        withCloseButton: false,
      });
      titles.current.set(actionId, title);
      const message = early.current.get(actionId);
      if (message !== undefined) {
        early.current.delete(actionId);
        if (show(actionId, title, message)) titles.current.delete(actionId);
      }
    },
    /** Call when the server refused to start the action. */
    refused(title: string, error: Error): void {
      notifications.show({
        title,
        message: `Failed: ${error.message}`,
        color: 'red',
        autoClose: 8000,
      });
    },
  };
}
