// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createOverlaySdk, type OverlaySocketLike } from './sdk.js';

const W = 'abcdefghij12';

class FakeSocket implements OverlaySocketLike {
  static instances: FakeSocket[] = [];
  readonly sent: Record<string, unknown>[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    // Not needed.
  }
  open(): void {
    this.onopen?.(new Event('open'));
  }
  receive(message: Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
  drop(code = 1006): void {
    this.onclose?.(new CloseEvent('close', { code }));
  }
}

function latest(): FakeSocket {
  const socket = FakeSocket.instances.at(-1);
  if (socket === undefined) throw new Error('no socket');
  return socket;
}

function init(settings: Record<string, unknown> = { size: 48 }, active = true) {
  return {
    type: 'init',
    widget: { id: W, name: 'Banner', type: 'overly.text-banner:banner' },
    active,
    settings,
  };
}

function start(path = `/o/${W}`) {
  window.history.replaceState(null, '', path);
  return createOverlaySdk({
    window,
    createSocket: (url) => new FakeSocket(url),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: (handle) => {
      window.clearTimeout(handle);
    },
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
// eslint-disable-next-line @typescript-eslint/unbound-method -- restored as is after each test
const originalPlay = HTMLMediaElement.prototype.play;

beforeEach(() => {
  FakeSocket.instances = [];
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
});

afterEach(() => {
  vi.useRealTimers();
  HTMLMediaElement.prototype.play = originalPlay;
  document.documentElement.style.visibility = '';
});

describe('createOverlaySdk', () => {
  it('reads the widget ID and preview flags from the URL', () => {
    expect(start()).toMatchObject({ widgetId: W, isPreview: false, muted: false });
    expect(start(`/o/${W}?preview=1`)).toMatchObject({ isPreview: true, muted: true });
    expect(start(`/o/${W}?preview=1&muted=0`)).toMatchObject({ isPreview: true, muted: false });
  });

  it('connects to the overlay socket once the document is loaded', () => {
    start(`/o/${W}?preview=1`);
    expect(latest().url).toBe(`ws://${window.location.host}/o/${W}/ws?preview=1`);
  });

  it('delivers settings from init and from later settings messages', () => {
    const sdk = start();
    const seen: unknown[] = [];
    sdk.onSettings((settings, widget) => seen.push([settings, widget.name]));
    latest().receive(init({ size: 48 }));
    latest().receive({ type: 'settings', settings: { size: 60 } });
    expect(seen).toEqual([
      [{ size: 48 }, 'Banner'],
      [{ size: 60 }, 'Banner'],
    ]);
    expect(sdk.settings).toEqual({ size: 60 });
  });

  it('calls onSettings at once when settings already arrived', () => {
    const sdk = start();
    latest().receive(init({ size: 48 }));
    const seen: unknown[] = [];
    sdk.onSettings((settings) => seen.push(settings));
    expect(seen).toEqual([{ size: 48 }]);
  });

  it('answers actionDone with the handler result', async () => {
    const sdk = start();
    sdk.onAction('show', (params) => Promise.resolve({ shown: params['text'] }));
    latest().receive({ type: 'action', id: 'd1', name: 'show', params: { text: 'hi' } });
    await flush();
    expect(latest().sent).toEqual([{ type: 'actionDone', id: 'd1', result: { shown: 'hi' } }]);
  });

  it('answers actionFailed when the handler throws', async () => {
    const sdk = start();
    sdk.onAction('show', () => {
      throw new Error('cannot show');
    });
    latest().receive({ type: 'action', id: 'd1', name: 'show', params: {} });
    await flush();
    expect(latest().sent).toEqual([{ type: 'actionFailed', id: 'd1', error: 'cannot show' }]);
  });

  it('fails an action without a handler', async () => {
    start();
    latest().receive({ type: 'action', id: 'd2', name: 'spin', params: {} });
    await flush();
    expect(latest().sent).toEqual([
      { type: 'actionFailed', id: 'd2', error: 'no handler for "spin"' },
    ]);
  });

  it('passes custom messages to their listeners', () => {
    const sdk = start();
    const seen: unknown[] = [];
    const off = sdk.on('banner', (payload) => seen.push(payload));
    latest().receive({ type: 'message', name: 'banner', payload: { visible: true } });
    off();
    latest().receive({ type: 'message', name: 'banner', payload: { visible: false } });
    expect(seen).toEqual([{ visible: true }]);
  });

  it('hides the page while inactive', () => {
    start();
    latest().receive(init({}, false));
    expect(document.documentElement.style.visibility).toBe('hidden');
    latest().receive({ type: 'widget', name: 'Banner', active: true });
    expect(document.documentElement.style.visibility).toBe('');
  });

  it('reconnects with backoff and stops after 4404', () => {
    vi.useFakeTimers();
    start();
    latest().drop();
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);
    latest().drop();
    vi.advanceTimersByTime(999);
    expect(FakeSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(3);
    latest().open();
    latest().drop();
    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(4);
    latest().drop(4404);
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.instances).toHaveLength(4);
    expect(document.documentElement.style.visibility).toBe('hidden');
  });

  it('mutes media in a muted preview', async () => {
    start(`/o/${W}?preview=1`);
    const audio = document.createElement('audio');
    await audio.play();
    expect(audio.muted).toBe(true);
  });

  it('leaves media alone outside the preview', async () => {
    start();
    const audio = document.createElement('audio');
    await audio.play();
    expect(audio.muted).toBe(false);
  });

  it('applies draft settings from the parent in preview only', () => {
    const post = (source: MessageEventSource | null, settings: unknown) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          data: { source: 'overly-dashboard', type: 'draft-settings', settings },
        }),
      );
    };
    const sdk = start(`/o/${W}?preview=1`);
    const seen: unknown[] = [];
    sdk.onSettings((settings) => seen.push(settings));
    latest().receive(init({ size: 48 }));
    post(window.parent, { size: 99 });
    latest().receive({ type: 'settings', settings: { size: 50 } });
    expect(sdk.settings).toEqual({ size: 99 });
    post(null, { size: 1 });
    post(window.parent, null);
    expect(seen).toEqual([{ size: 48 }, { size: 99 }, { size: 99 }, { size: 50 }]);
  });

  it('ignores draft settings outside the preview', () => {
    const sdk = start();
    latest().receive(init({ size: 48 }));
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { source: 'overly-dashboard', type: 'draft-settings', settings: { size: 1 } },
      }),
    );
    expect(sdk.settings).toEqual({ size: 48 });
  });

  it('builds asset URLs', () => {
    const sdk = start();
    expect(sdk.assetUrl('')).toBe('');
    expect(sdk.assetUrl('abcdefghij12')).toBe('/assets/abcdefghij12');
  });
});
