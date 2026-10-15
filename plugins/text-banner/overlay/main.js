// @ts-check
import { applySettings, isBannerState, renderBanner } from './banner.js';

const root = document.getElementById('banner');
if (root === null) throw new Error('index.html has no #banner element');

overly.onSettings((settings) => {
  applySettings(root, settings);
});

// The backend sends the banner state when it changes and when this page connects.
overly.on('banner', (payload) => {
  if (isBannerState(payload)) renderBanner(root, payload);
});
