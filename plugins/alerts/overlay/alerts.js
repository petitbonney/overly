// @ts-check

/** How long the fade-out takes (see style.css). */
export const FADE_MS = 400;

/**
 * @typedef {{ title: string, message: string, variant: string }} Alert
 * @typedef {{ assetUrl(id: string): string, wait(ms: number): Promise<void> }} AlertDeps
 */

/**
 * Replaces {{title}}, {{message}} and {{variant}} (spaces allowed inside the braces). Other
 * placeholders stay as they are, so a typo shows up on screen.
 * @param {string} template
 * @param {Alert} values
 * @returns {string}
 */
export function renderTemplate(template, values) {
  return template.replace(
    /\{\{\s*(title|message|variant)\s*\}\}/g,
    (_match, /** @type {'title' | 'message' | 'variant'} */ name) => values[name],
  );
}

/**
 * Applies fonts, colors and the layout from the settings.
 * @param {HTMLElement} root
 * @param {Record<string, unknown>} settings
 */
export function applyStyle(root, settings) {
  root.style.setProperty('--alert-font', String(settings['fontFamily'] ?? 'system-ui, sans-serif'));
  root.style.setProperty('--alert-size', `${String(settings['fontSize'] ?? 48)}px`);
  root.style.setProperty('--alert-color', String(settings['textColor'] ?? '#ffffff'));
  root.dataset['layout'] = String(settings['layout'] ?? 'image-above');
}

/**
 * Plays one alert: image, text and sound, then hides it after the configured duration. Text is
 * set with textContent, never read as HTML. A sound the browser refuses to play is skipped.
 * @param {HTMLElement} root
 * @param {Alert} alert
 * @param {Record<string, unknown>} settings
 * @param {AlertDeps} deps
 * @returns {Promise<void>}
 */
export async function playAlert(root, alert, settings, deps) {
  const headline = root.querySelector('.alert-headline');
  const message = /** @type {HTMLElement | null} */ (root.querySelector('.alert-message'));
  const image = /** @type {HTMLImageElement | null} */ (root.querySelector('.alert-image'));

  if (headline !== null) {
    headline.textContent = renderTemplate(String(settings['textTemplate'] ?? '{{title}}'), alert);
  }
  if (message !== null) {
    message.textContent = alert.message;
    message.hidden = alert.message === '';
  }
  const imageUrl = deps.assetUrl(String(settings['image'] ?? ''));
  if (image !== null) {
    image.hidden = imageUrl === '';
    if (imageUrl === '') image.removeAttribute('src');
    else image.setAttribute('src', imageUrl);
  }

  const soundUrl = deps.assetUrl(String(settings['sound'] ?? ''));
  /** @type {HTMLAudioElement | undefined} */
  let audio;
  if (soundUrl !== '') {
    audio = root.ownerDocument.createElement('audio');
    audio.setAttribute('src', soundUrl);
    audio.volume = Math.min(1, Math.max(0, Number(settings['volume'] ?? 80) / 100));
    audio.play().catch(() => undefined);
  }

  root.classList.add('visible');
  await deps.wait(Number(settings['durationSeconds'] ?? 6) * 1000);
  root.classList.remove('visible');
  await deps.wait(FADE_MS);
  // A sound longer than the alert stops with it, so it never plays over the next one.
  audio?.pause();
}
