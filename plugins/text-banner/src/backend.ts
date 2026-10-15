import { definePluginBackend, defineWidgetBackend } from '@overly/sdk/backend';

/** What the banner shows. Saved with the widget, so it survives OBS refreshes and restarts. */
export interface BannerState {
  visible: boolean;
  text: string;
}

const banner = defineWidgetBackend<Record<string, unknown>, BannerState>({
  initialState: { visible: false, text: '' },
  onOverlayConnect(ctx, overlay) {
    overlay.emit('banner', ctx.state);
  },
  actions: {
    show(params, ctx) {
      ctx.setState({ visible: true, text: String(params['text']) });
      ctx.emitToOverlay('banner', ctx.state);
    },
    hide(_params, ctx) {
      ctx.setState({ ...ctx.state, visible: false });
      ctx.emitToOverlay('banner', ctx.state);
    },
  },
});

export default definePluginBackend({ widgets: { banner } });
