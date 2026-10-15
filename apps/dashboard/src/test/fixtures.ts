import type { PluginInfo, WidgetDetail, WidgetSummary, WidgetTypeInfo } from '@overly/shared';

export const alertsType: WidgetTypeInfo = {
  type: 'overly.alerts:alerts',
  pluginId: 'overly.alerts',
  name: 'Alerts',
  description: 'Shows an image, plays a sound and displays a message.',
  iconUrl: '/plugins/overly.alerts/icons/alerts.svg',
  settings: {
    type: 'object',
    properties: {
      textTemplate: { type: 'string', title: 'Text template', default: '{{title}}' },
      volume: { type: 'integer', title: 'Volume', minimum: 0, maximum: 100, default: 80 },
    },
  },
  overlay: { width: 1920, height: 1080 },
  actions: [
    {
      name: 'show-alert',
      title: 'Show alert',
      params: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
      sample: { title: 'Ada just followed!' },
      queued: true,
    },
  ],
  events: [],
};

export const bannerType: WidgetTypeInfo = {
  ...alertsType,
  type: 'overly.text-banner:banner',
  pluginId: 'overly.text-banner',
  name: 'Text banner',
  description: 'Shows a line of text until you hide it.',
  iconUrl: '/plugins/overly.text-banner/icons/banner.svg',
  actions: [],
};

export const okPlugins: PluginInfo[] = [
  {
    id: 'overly.alerts',
    folder: 'alerts',
    name: 'Alerts',
    version: '1.0.0',
    iconUrl: null,
    status: 'ok',
    errors: [],
    widgetTypes: [alertsType],
  },
  {
    id: 'overly.text-banner',
    folder: 'text-banner',
    name: 'Text banner',
    version: '1.0.0',
    iconUrl: null,
    status: 'ok',
    errors: [],
    widgetTypes: [bannerType],
  },
];

export const brokenPlugin: PluginInfo = {
  id: null,
  folder: 'odd-plugin',
  name: 'odd-plugin',
  version: null,
  iconUrl: null,
  status: 'broken',
  errors: ['overly.plugin.json is not valid JSON: Unexpected end of JSON input'],
  widgetTypes: [],
};

export function summary(overrides: Partial<WidgetSummary> = {}): WidgetSummary {
  return {
    id: 'abcdefghij12',
    name: 'Alerts',
    type: 'overly.alerts:alerts',
    typeName: 'Alerts',
    iconUrl: '/plugins/overly.alerts/icons/alerts.svg',
    enabled: true,
    status: 'ok',
    problems: [],
    ...overrides,
  };
}

export function detail(overrides: Partial<WidgetDetail> = {}): WidgetDetail {
  return {
    ...summary(),
    settings: { textTemplate: '{{title}}', volume: 80 },
    overlayUrl: 'http://127.0.0.1:6860/o/abcdefghij12',
    overlay: { width: 1920, height: 1080 },
    runtime: { overlays: { live: 0, preview: 0 }, queue: { pending: 0, running: null } },
    ...overrides,
  };
}
