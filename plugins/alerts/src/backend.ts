import { definePluginBackend, defineWidgetBackend } from '@overly/sdk/backend';

const alerts = defineWidgetBackend({
  actions: {
    // The widget's queue runs one show-alert at a time; this waits until an overlay played it.
    async 'show-alert'(params, ctx) {
      const outcome = await ctx.runOverlayAction('show-alert', params);
      if (!outcome.delivered) return { delivered: false };
      ctx.emitEvent('alert.finished', {
        title: params['title'],
        message: params['message'],
        variant: params['variant'],
      });
      return outcome.result;
    },
  },
});

export default definePluginBackend({ widgets: { alerts } });
