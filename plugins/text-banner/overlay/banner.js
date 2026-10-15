// @ts-check

/**
 * Applies the widget settings: CSS custom properties for colors and fonts, and attributes for
 * the position and the animation (see style.css).
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} settings
 */
export function applySettings(root, settings) {
  root.style.setProperty(
    '--banner-font',
    String(settings['fontFamily'] ?? 'system-ui, sans-serif'),
  );
  root.style.setProperty('--banner-size', `${String(settings['fontSize'] ?? 48)}px`);
  root.style.setProperty('--banner-color', String(settings['textColor'] ?? '#ffffff'));
  root.style.setProperty('--banner-bg', String(settings['backgroundColor'] ?? '#000000b3'));
  root.dataset['position'] = String(settings['position'] ?? 'bottom');
  root.dataset['animation'] = String(settings['animation'] ?? 'slide');
}

/**
 * Shows or hides the banner. The text is set with textContent, so it is never read as HTML.
 * @param {HTMLElement} root
 * @param {{ visible: boolean, text: string }} state
 */
export function renderBanner(root, state) {
  const text = root.querySelector('.banner-text');
  if (text !== null) text.textContent = state.text;
  root.classList.toggle('visible', state.visible);
}

/**
 * @param {unknown} payload
 * @returns {payload is { visible: boolean, text: string }}
 */
export function isBannerState(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'visible' in payload &&
    typeof payload.visible === 'boolean' &&
    'text' in payload &&
    typeof payload.text === 'string'
  );
}
