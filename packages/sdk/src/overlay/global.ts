// Entry of the overlay SDK bundle (bun build --format=iife), served at /sdk/overlay.js and
// injected into every overlay page before the plugin's own scripts.
import { createOverlaySdk } from './sdk.js';

window.overly = createOverlaySdk({
  window,
  createSocket: (url) => new WebSocket(url),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle);
  },
});
