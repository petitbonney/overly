// @ts-check
import { applyStyle, playAlert } from './alerts.js';

const root = document.getElementById('alert');
if (root === null) throw new Error('index.html has no #alert element');

/** @type {Record<string, unknown>} */
let settings = {};

overly.onSettings((next) => {
  settings = next;
  applyStyle(root, next);
});

/** @param {number} ms */
const wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// The server sends one alert at a time and waits for this handler to finish.
overly.onAction('show-alert', async (params) => {
  await playAlert(
    root,
    {
      title: String(params['title'] ?? ''),
      message: String(params['message'] ?? ''),
      variant: String(params['variant'] ?? 'default'),
    },
    settings,
    { assetUrl: (id) => overly.assetUrl(id), wait },
  );
});
