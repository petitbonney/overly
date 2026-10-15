// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyStyle, playAlert, renderTemplate } from '../overlay/alerts.js';

let root: HTMLElement;
let played: HTMLMediaElement[];

beforeEach(() => {
  document.body.innerHTML = `
    <div id="alert">
      <img class="alert-image" alt="" hidden />
      <div class="alert-text">
        <div class="alert-headline"></div>
        <div class="alert-message" hidden></div>
      </div>
    </div>`;
  const element = document.getElementById('alert');
  if (element === null) throw new Error('no alert');
  root = element;
  played = [];
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    played.push(this);
    return Promise.resolve();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const alert = { title: 'Ada', message: 'Thanks for the follow', variant: 'follow' };
const assetUrl = (id: string) => (id === '' ? '' : `/assets/${id}`);

describe('renderTemplate', () => {
  it('renders the known placeholders with or without spaces', () => {
    expect(renderTemplate('{{title}} / {{ message }} / {{variant}} / {{other}}', alert)).toBe(
      'Ada / Thanks for the follow / follow / {{other}}',
    );
  });
});

describe('playAlert', () => {
  it('plays image, text and sound, then hides', async () => {
    const waits: [number, boolean][] = [];
    await playAlert(
      root,
      alert,
      {
        image: 'abcdefghij12',
        sound: 'zzzzzzzzzz99',
        volume: 80,
        durationSeconds: 6,
        textTemplate: '{{title}} just followed!',
      },
      {
        assetUrl,
        wait: (ms) => {
          waits.push([ms, root.classList.contains('visible')]);
          return Promise.resolve();
        },
      },
    );
    expect(waits).toEqual([
      [6000, true],
      [400, false],
    ]);
    expect(root.querySelector('.alert-headline')?.textContent).toBe('Ada just followed!');
    const message = root.querySelector<HTMLElement>('.alert-message');
    expect(message?.textContent).toBe('Thanks for the follow');
    expect(message?.hidden).toBe(false);
    const image = root.querySelector<HTMLImageElement>('.alert-image');
    expect(image?.getAttribute('src')).toBe('/assets/abcdefghij12');
    expect(image?.hidden).toBe(false);
    expect(played).toHaveLength(1);
    expect(played[0]?.getAttribute('src')).toBe('/assets/zzzzzzzzzz99');
    expect(played[0]?.volume).toBe(0.8);
  });

  it('shows text only when there is no image, sound or message', async () => {
    await playAlert(
      root,
      { ...alert, message: '' },
      { image: '', sound: '', durationSeconds: 1 },
      { assetUrl, wait: () => Promise.resolve() },
    );
    expect(root.querySelector<HTMLImageElement>('.alert-image')?.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.alert-message')?.hidden).toBe(true);
    expect(root.querySelector('.alert-headline')?.textContent).toBe('Ada');
    expect(played).toEqual([]);
  });

  it('ignores a rejected play()', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('NotAllowedError'));
    await expect(
      playAlert(
        root,
        alert,
        { sound: 'zzzzzzzzzz99' },
        { assetUrl, wait: () => Promise.resolve() },
      ),
    ).resolves.toBeUndefined();
  });

  it('renders text literally', async () => {
    await playAlert(
      root,
      { ...alert, title: '<img src=x onerror=alert(1)>' },
      {},
      { assetUrl, wait: () => Promise.resolve() },
    );
    expect(root.querySelector('.alert-headline')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(root.querySelectorAll('img')).toHaveLength(1);
  });
});

describe('applyStyle', () => {
  it('applies fonts, colors and the layout', () => {
    applyStyle(root, {
      fontFamily: 'Georgia, serif',
      fontSize: 60,
      textColor: '#ff0000',
      layout: 'image-left',
    });
    expect(root.style.getPropertyValue('--alert-font')).toBe('Georgia, serif');
    expect(root.style.getPropertyValue('--alert-size')).toBe('60px');
    expect(root.style.getPropertyValue('--alert-color')).toBe('#ff0000');
    expect(root.dataset['layout']).toBe('image-left');
  });
});
