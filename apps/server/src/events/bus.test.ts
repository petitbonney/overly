import { expect, it } from 'vitest';

import { EventBus, type WidgetEvent } from './bus.js';

const event: WidgetEvent = {
  source: 'widget',
  widgetId: 'abcdefghij12',
  widgetType: 'overly.alerts:alerts',
  name: 'alert.finished',
  payload: { title: 'Hi' },
  at: '2026-10-15T09:00:00.000Z',
};

it('delivers events to subscribers until they unsubscribe', () => {
  const bus = new EventBus();
  const seen: WidgetEvent[] = [];
  const unsubscribe = bus.subscribe((received) => seen.push(received));
  bus.publish(event);
  unsubscribe();
  bus.publish(event);
  expect(seen).toEqual([event]);
});

it('keeps delivering when a subscriber throws', () => {
  const bus = new EventBus();
  const seen: string[] = [];
  bus.subscribe(() => {
    throw new Error('bad listener');
  });
  bus.subscribe((received) => seen.push(received.name));
  bus.publish(event);
  expect(seen).toEqual(['alert.finished']);
});
