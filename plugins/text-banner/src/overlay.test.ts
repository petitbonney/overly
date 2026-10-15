// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';

import { applySettings, renderBanner } from '../overlay/banner.js';

let root: HTMLElement;

beforeEach(() => {
  document.body.innerHTML =
    '<div id="banner"><div class="banner-box"><span class="banner-text"></span></div></div>';
  const element = document.getElementById('banner');
  if (element === null) throw new Error('no banner');
  root = element;
});

it('applies settings as CSS variables and attributes', () => {
  applySettings(root, {
    position: 'top',
    fontFamily: 'Georgia, serif',
    fontSize: 64,
    textColor: '#ff0000',
    backgroundColor: '#00000080',
    animation: 'fade',
  });
  expect(root.style.getPropertyValue('--banner-font')).toBe('Georgia, serif');
  expect(root.style.getPropertyValue('--banner-size')).toBe('64px');
  expect(root.style.getPropertyValue('--banner-color')).toBe('#ff0000');
  expect(root.style.getPropertyValue('--banner-bg')).toBe('#00000080');
  expect(root.dataset['position']).toBe('top');
  expect(root.dataset['animation']).toBe('fade');
});

it('shows and hides the banner', () => {
  renderBanner(root, { visible: true, text: 'Welcome!' });
  expect(root.classList.contains('visible')).toBe(true);
  expect(root.querySelector('.banner-text')?.textContent).toBe('Welcome!');
  renderBanner(root, { visible: false, text: 'Welcome!' });
  expect(root.classList.contains('visible')).toBe(false);
  expect(root.querySelector('.banner-text')?.textContent).toBe('Welcome!');
});

it('renders text literally', () => {
  renderBanner(root, { visible: true, text: '<b>x</b>' });
  expect(root.querySelector('.banner-text')?.textContent).toBe('<b>x</b>');
  expect(root.querySelector('b')).toBeNull();
});
